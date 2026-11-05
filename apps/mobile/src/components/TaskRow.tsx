import type { IsoDate, Label, Member, Project, Task } from '@balu/domain';
import { initials } from '../lib/collab';
import { useMemo, useRef, useState } from 'react';
import { type AccessibilityActionEvent, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useNavigation } from 'expo-router';
import Animated, { FadeOut, useSharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureStateManager, useManualGesture } from 'react-native-gesture-handler';
import ReanimatedSwipeable, {
  SwipeDirection,
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { completeTask, uncompleteTask } from '../lib/actions';
import { metaLayout, moreLabelsText, rowDate, rowLabels } from '../lib/rowMeta';
import { hapticComplete } from '../lib/haptics';
import { dispatchRowAction, rowAccessibilityActions } from '../lib/rowActions';
import { useT } from '../i18n';
import { useApp } from '../store/app';
import { useTheme } from '../theme/ThemeProvider';
import { duration, font, gutter, projectHex, radius, rowMin, space } from '../theme/tokens';
import { Checkbox } from './Checkbox';
import { Icon } from './Icon';

/** Width (dp) of the left screen-edge strip left to the iOS back swipe. */
const EDGE_BACK_ZONE = 24;

export interface TaskRowProps {
  task: Task;
  today: IsoDate;
  projects: Map<string, Project>;
  labels: Map<string, Label>;
  members?: Map<string, Member>;
  commentCount?: number;
  /** Hide the project dot/name (e.g. inside a project view). */
  hideProject?: boolean;
  /** Today list: a task due today needs no "Today" date chip. Overdue and future dates stay. */
  hideTodayDate?: boolean;
  swipeable?: boolean;
  /** False for read-only members (viewers): the checkbox is inert and there are no swipe actions (§2). */
  writable: boolean;
}

export function TaskRow({ task, today, projects, labels, members, commentCount = 0, hideProject, hideTodayDate, swipeable = true, writable }: TaskRowProps) {
  const theme = useTheme();
  const { t, locale } = useT();
  const openDetail = useApp((s) => s.openDetail);
  const openSchedule = useApp((s) => s.openSchedule);
  const swipeRef = useRef<SwipeableMethods>(null);
  const [done, setDone] = useState(false);
  // Rows without swipe actions (viewers, list/search screens) still claim a
  // horizontal pan. It does nothing itself, but when it activates
  // gesture-handler cancels the row's Pressable - otherwise a sideways swipe
  // ends as a tap and opens the detail sheet. Vertical movement fails it, so
  // the list still scrolls. 10 px matches ReanimatedSwipeable's default drag offset.
  //
  // iOS back swipe: the native-stack back gesture is UIKit's edge-pan recognizer,
  // which react-native-gesture-handler does not manage; RNGH only resolves
  // relations between its own handlers and scroll views
  // (RNGestureHandler.mm shouldRecognizeSimultaneously/RequireFailure), so UIKit's
  // default (deepest view's recognizer first) would apply and this pan could win
  // over the back swipe. That cannot be ruled out from source, so the guard
  // ignores touches in the left edge zone (negative hitSlop shrinks its area).
  // A sideways swipe that starts there is the back gesture, not a row swipe.
  // Only on iOS and only where there is a screen to go back to: on Android and
  // on tab roots the guard must keep covering the whole row. Tab navigators
  // report canGoBack() (back goes to the first tab) but have no back swipe, so
  // only a stack counts.
  const navigation = useNavigation();
  const edgeBack = Platform.OS === 'ios' && navigation.getState()?.type === 'stack' && navigation.canGoBack();
  const swipeGuard = useMemo(() => {
    const pan = Gesture.Pan();
    if (edgeBack) pan.hitSlop({ left: -EDGE_BACK_ZONE });
    return pan.activeOffsetX([-10, 10]).failOffsetY([-10, 10]);
  }, [edgeBack]);
  // Writer rows: ReanimatedSwipeable's own pan covers the whole row. A Manual
  // gesture over the edge strip never activates (it fails when the finger
  // lifts), and the swipeable requires it to fail first, so a drag that starts
  // in the strip stays with the back swipe. Not the swipeable's hitSlop prop:
  // that is a view-level slop and would also kill taps on the checkbox.
  // It also fails as soon as the touch moves leftward or vertically (the back
  // swipe is rightward only), so UIKit does not hold a swipeable activation
  // until lift and replay it late. The callbacks must stay worklets (no
  // runOnJS): GestureStateManager.fail() goes through Reanimated's
  // setGestureState, which is a no-op with a warning on the JS thread. Worklets
  // get a copy of captured variables, so the touch-down point lives in shared values.
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const edgeBlock = useManualGesture({
    hitSlop: { left: 0, width: EDGE_BACK_ZONE },
    onTouchesDown: (e) => {
      'worklet';
      startX.value = e.allTouches[0]?.x ?? 0;
      startY.value = e.allTouches[0]?.y ?? 0;
    },
    onTouchesMove: (e) => {
      'worklet';
      const touch = e.allTouches[0];
      if (!touch) return;
      if (touch.x - startX.value < -10 || Math.abs(touch.y - startY.value) > 10) GestureStateManager.fail(e.handlerTag);
    },
    onTouchesUp: (e) => {
      'worklet';
      GestureStateManager.fail(e.handlerTag);
    },
    onTouchesCancel: (e) => {
      'worklet';
      GestureStateManager.fail(e.handlerTag);
    },
  });

  const completed = task.completed_at != null;
  const checked = completed || done;

  const completeWithLinger = () => {
    if (completed) {
      setDone(false);
      uncompleteTask(task.id);
      return;
    }
    // Checkbox and the accessibility action stay live during the linger: once only.
    if (done) return;
    setDone(true);
    hapticComplete();
    // Row lingers ~600ms (DESIGN §5) before the mutation removes it from the list.
    setTimeout(() => completeTask(task.id), duration.complete);
  };

  const onSwipeableOpen = (direction: SwipeDirection) => {
    swipeRef.current?.close();
    // SwipeDirection is the direction of the swipe itself: RIGHT = swiped
    // rightward (left/green check actions revealed) = complete; LEFT = swiped
    // leftward (right/calendar actions revealed) = schedule.
    if (direction === SwipeDirection.RIGHT) {
      completeWithLinger();
    } else {
      openSchedule(task.id);
    }
  };

  // Swipes are unreachable with TalkBack/VoiceOver (they consume the gestures),
  // so expose both swipe actions as accessibility actions.
  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    dispatchRowAction(e.nativeEvent.actionName, { complete: completeWithLinger, schedule: () => openSchedule(task.id) });
  };

  // ── metadata chips ──
  const project = task.project_id ? projects.get(task.project_id) : undefined;
  // Like the web row: the today chip is hidden only in the Today list.
  const date = rowDate(task, today, locale, t, hideTodayDate ?? false);
  const dateInfo = date?.info ?? null;
  const dateColor =
    dateInfo?.tone === 'overdue' ? theme.danger : dateInfo?.tone === 'today' ? theme.accent : theme.textSecondary;
  const isDeadlineOnly = date?.isDeadlineOnly ?? false;
  const { visible: shownLabels, overflow: hiddenLabels } = rowLabels(task.label_ids, labels);
  const assignee = task.assigned_to ? members?.get(task.assigned_to) : undefined;
  const hasComments = commentCount > 0;

  // One computation drives both the listed actions and the handler, so they cannot diverge.
  const a11yActions = rowAccessibilityActions(swipeable, writable, {
    complete: t('row.complete'),
    schedule: t('schedule.title'),
  });
  // The title is one line, so its laid-out height is its line height, which the
  // system font scale changes; the checkbox is centred on it.
  // Starts at the scaled line height so the checkbox does not jump after the
  // first layout; onLayout then corrects it to the exact value.
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const [titleHeight, setTitleHeight] = useState(titleLineHeight * fontScale);
  // The meta row is laid out deterministically. The shrinkable project/labels
  // group is never inside a wrapping container (Yoga breaks a wrapping line by
  // hypothetical size and then does not shrink its items): inline, one nowrap
  // line where only that group shrinks; stacked (narrow screen or large font
  // scale), that group on its own line and the fixed items in a line below that
  // may wrap. Every fixed item is noShrink, so that wrapping is safe.
  const stacked = metaLayout(windowWidth, fontScale) === 'stacked';
  const dateEl = dateInfo ? (
    <View style={[styles.metaItem, styles.noShrink]}>
      {isDeadlineOnly && <Icon name="flag" size={12} color={dateColor} strokeWidth={2} />}
      <Text style={[styles.metaText, { color: dateColor }]}>{dateInfo.text}</Text>
    </View>
  ) : null;
  const recurEl = task.recurrence ? (
    <View style={styles.noShrink}>
      <Icon name="repeat" size={13} color={theme.textTertiary} strokeWidth={2} />
    </View>
  ) : null;
  const showProject = !hideProject && project != null;
  const projectLabelsEl =
    showProject || shownLabels.length > 0 ? (
      <View style={styles.shrinkGroup}>
        {showProject && project && (
          <View style={[styles.metaItem, styles.projectChip]}>
            <View style={[styles.dot, { backgroundColor: projectHex(project.color) }]} />
            <Text style={[styles.metaText, styles.shrink, { color: theme.textSecondary }]} numberOfLines={1}>
              {project.name}
            </Text>
          </View>
        )}
        {shownLabels.map((l, i) => (
          <Text
            key={l.id}
            style={[styles.metaText, styles.labelChip, (showProject || i > 0) && styles.groupGap, { color: projectHex(l.color) }]}
            numberOfLines={1}
          >
            @{l.name}
          </Text>
        ))}
      </View>
    ) : null;
  // "+N" sits outside the clipping group (and never shrinks), so the count of
  // hidden labels stays visible even when the project and labels are cut off.
  const moreEl =
    hiddenLabels > 0 ? (
      <Text
        accessibilityLabel={moreLabelsText(hiddenLabels, t)}
        style={[styles.metaText, styles.noShrink, styles.groupGap, { color: theme.textTertiary }]}
      >
        +{hiddenLabels}
      </Text>
    ) : null;
  const chipsEl = projectLabelsEl ? (
    <View style={styles.chipsRow}>
      {projectLabelsEl}
      {moreEl}
    </View>
  ) : null;
  const priorityEl =
    task.priority === 1 || task.priority === 2 ? (
      <View style={styles.noShrink}>
        <Icon
          name="flag"
          size={13}
          color={task.priority === 1 ? theme.priority1 : theme.priority2}
          fill={task.priority === 1 ? theme.priority1 : theme.priority2}
          strokeWidth={2}
        />
      </View>
    ) : null;
  const commentsEl = hasComments ? (
    <View style={[styles.metaItem, styles.noShrink]}>
      <Icon name="message-square" size={12} color={theme.textTertiary} strokeWidth={2} />
      <Text style={[styles.metaText, { color: theme.textTertiary }]}>{commentCount}</Text>
    </View>
  ) : null;
  const avatarEl = assignee ? (
    <View style={[styles.avatar, { backgroundColor: theme.accentWash, borderColor: theme.accent }]}>
      <Text style={[styles.avatarText, { color: theme.accent }]}>{initials(assignee.name)}</Text>
    </View>
  ) : null;
  const hasFixed = dateEl != null || recurEl != null || priorityEl != null || commentsEl != null || avatarEl != null;
  // From what is actually rendered: priority 3 shows only as the checkbox ring,
  // so it must not produce an empty meta line or switch the row to top alignment.
  const hasMeta = chipsEl != null || hasFixed;
  const content = (
    <Pressable
      onPress={() => openDetail(task.id)}
      // Only rows with swipe actions: the same two actions as swipe right / left.
      accessibilityActions={a11yActions}
      onAccessibilityAction={a11yActions ? onAccessibilityAction : undefined}
      style={[styles.row, hasMeta && styles.rowTop, { backgroundColor: theme.bg, borderBottomColor: theme.border }]}
    >
      <View style={hasMeta ? { marginTop: (titleHeight - checkboxSize) / 2 } : undefined}>
        <Checkbox checked={checked} priority={task.priority} onToggle={writable ? completeWithLinger : undefined} />
      </View>
      <View style={styles.body}>
        <Text
          numberOfLines={1}
          onLayout={(e) => setTitleHeight(e.nativeEvent.layout.height)}
          style={[
            styles.title,
            { color: checked ? theme.textTertiary : theme.textPrimary },
            checked && styles.strike,
          ]}
        >
          {task.title}
        </Text>
        {hasMeta && !stacked && (
          <View style={styles.meta}>
            {dateEl}
            {recurEl}
            {chipsEl}
            {priorityEl}
            {commentsEl}
            {avatarEl}
          </View>
        )}
        {hasMeta && stacked && (
          <View style={styles.metaStack}>
            {chipsEl && <View style={styles.metaLine}>{chipsEl}</View>}
            {hasFixed && (
              <View style={styles.metaFixed}>
                {dateEl}
                {recurEl}
                {priorityEl}
                {commentsEl}
                {avatarEl}
              </View>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );

  if (!swipeable || !writable) {
    return (
      <Animated.View exiting={FadeOut.duration(duration.medium)}>
        <GestureDetector gesture={swipeGuard}>
          <View collapsable={false}>{content}</View>
        </GestureDetector>
      </Animated.View>
    );
  }

  const swipe = (
    <ReanimatedSwipeable
      ref={swipeRef}
      requireToFail={edgeBack ? edgeBlock : undefined}
      friction={2}
      leftThreshold={56}
      rightThreshold={56}
      overshootLeft={false}
      overshootRight={false}
      onSwipeableOpen={onSwipeableOpen}
      renderLeftActions={() => (
        <View style={[styles.action, { backgroundColor: theme.success, alignItems: 'flex-start' }]}>
          <Icon name="check" size={22} color="#fff" strokeWidth={2.5} />
        </View>
      )}
      renderRightActions={() => (
        <View style={[styles.action, { backgroundColor: theme.accent, alignItems: 'flex-end' }]}>
          <Icon name="calendar" size={20} color={theme.onAccent} strokeWidth={2.2} />
        </View>
      )}
    >
      {content}
    </ReanimatedSwipeable>
  );

  return (
    <Animated.View exiting={FadeOut.duration(duration.medium)}>
      {edgeBack ? (
        <GestureDetector gesture={edgeBlock}>
          <View collapsable={false}>{swipe}</View>
        </GestureDetector>
      ) : (
        swipe
      )}
    </Animated.View>
  );
}

const titleLineHeight = font.body * 1.25;
const checkboxSize = 24; // Checkbox default size

const styles = StyleSheet.create({
  row: {
    minHeight: rowMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    paddingHorizontal: gutter,
    paddingVertical: space.s2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Rows with a meta line top-align, so a wrapped meta line cannot pull the
  // checkbox away from the title; the checkbox is centred on the title's first
  // line (its line height scales with the system font scale).
  rowTop: { alignItems: 'flex-start' },
  body: { flex: 1, gap: 2 },
  title: { fontSize: font.body, fontWeight: font.weightRegular, lineHeight: titleLineHeight },
  strike: { textDecorationLine: 'line-through' },
  // Inline: one nowrap line; the fixed items are noShrink, so only the
  // project/labels group gives way when the line is too wide.
  meta: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: space.s2 },
  // Stacked: project/labels line above the fixed items line.
  metaStack: { gap: 2 },
  metaLine: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center' },
  metaFixed: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s2, rowGap: 2 },
  // Project and labels: a plain nowrap group Yoga shrinks correctly. The project
  // has the larger shrink factor and a 48dp floor; the group may shrink below its
  // content (minWidth 0) and clips what still overflows.
  chipsRow: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', flexShrink: 1, minWidth: 0 },
  shrinkGroup: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', flexShrink: 1, minWidth: 0, overflow: 'hidden' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 160 },
  projectChip: { flexShrink: 100, minWidth: 48 },
  labelChip: { flexShrink: 1, minWidth: 28, maxWidth: 120 },
  shrink: { flexShrink: 1, minWidth: 0 },
  noShrink: { flexShrink: 0 },
  groupGap: { marginLeft: space.s2 },
  metaText: { fontSize: font.caption, fontVariant: ['tabular-nums'] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  avatar: {
    minWidth: 18,
    minHeight: 18,
    borderRadius: 12,
    paddingHorizontal: 3,
    flexShrink: 0,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 10, fontWeight: font.weightSemibold },
  action: {
    justifyContent: 'center',
    paddingHorizontal: gutter + 4,
    flex: 1,
    borderRadius: radius.chip,
  },
});
