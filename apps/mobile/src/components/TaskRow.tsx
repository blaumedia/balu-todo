import type { IsoDate, Label, Member, Project, Task } from '@balu/domain';
import { initials } from '../lib/collab';
import { useMemo, useRef, useState } from 'react';
import { type AccessibilityActionEvent, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from 'expo-router';
import Animated, { FadeOut } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReanimatedSwipeable, {
  SwipeDirection,
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { completeTask, uncompleteTask } from '../lib/actions';
import { relativeDate } from '../lib/format';
import { hapticComplete } from '../lib/haptics';
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
  swipeable?: boolean;
  /** False for read-only members (viewers): the checkbox is inert and there are no swipe actions (§2). */
  writable: boolean;
}

export function TaskRow({ task, today, projects, labels, members, commentCount = 0, hideProject, swipeable = true, writable }: TaskRowProps) {
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
  // until lift and replay it late.
  const edgeBlock = useMemo(() => {
    let startX = 0;
    let startY = 0;
    return Gesture.Manual()
      .runOnJS(true)
      .hitSlop({ left: 0, width: EDGE_BACK_ZONE })
      .onTouchesDown((e) => {
        startX = e.allTouches[0]?.x ?? 0;
        startY = e.allTouches[0]?.y ?? 0;
      })
      .onTouchesMove((e, manager) => {
        const dx = (e.allTouches[0]?.x ?? startX) - startX;
        const dy = (e.allTouches[0]?.y ?? startY) - startY;
        if (dx < -10 || Math.abs(dy) > 10) manager.fail();
      })
      .onTouchesUp((_e, manager) => manager.fail())
      .onTouchesCancelled((_e, manager) => manager.fail());
  }, []);

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
    if (e.nativeEvent.actionName === 'complete') completeWithLinger();
    else if (e.nativeEvent.actionName === 'schedule') openSchedule(task.id);
  };

  // ── metadata chips ──
  const project = task.project_id ? projects.get(task.project_id) : undefined;
  const primaryDate = task.start_date ?? task.deadline;
  const dateInfo = primaryDate ? relativeDate(primaryDate, today, locale, t) : null;
  const showDate = dateInfo && dateInfo.tone !== 'today';
  const dateColor =
    dateInfo?.tone === 'overdue' ? theme.danger : dateInfo?.tone === 'today' ? theme.accent : theme.textSecondary;
  const isDeadlineOnly = task.start_date == null && task.deadline != null;
  const taskLabels = task.label_ids.map((id) => labels.get(id)).filter(Boolean) as Label[];
  const assignee = task.assigned_to ? members?.get(task.assigned_to) : undefined;
  const hasComments = commentCount > 0;

  const content = (
    <Pressable
      onPress={() => openDetail(task.id)}
      // Only rows with swipe actions: the same two actions as swipe right / left.
      accessibilityActions={
        swipeable && writable
          ? [
              { name: 'complete', label: t('row.complete') },
              { name: 'schedule', label: t('schedule.title') },
            ]
          : undefined
      }
      onAccessibilityAction={swipeable && writable ? onAccessibilityAction : undefined}
      style={[styles.row, { backgroundColor: theme.bg, borderBottomColor: theme.border }]}
    >
      <Checkbox checked={checked} priority={task.priority} onToggle={writable ? completeWithLinger : undefined} />
      <View style={styles.body}>
        <Text
          numberOfLines={1}
          style={[
            styles.title,
            { color: checked ? theme.textTertiary : theme.textPrimary },
            checked && styles.strike,
          ]}
        >
          {task.title}
        </Text>
        {(showDate ||
          (!hideProject && project) ||
          task.priority > 0 ||
          task.recurrence ||
          taskLabels.length > 0 ||
          assignee ||
          hasComments) && (
          <View style={styles.meta}>
            {showDate && (
              <View style={styles.metaItem}>
                {isDeadlineOnly && <Icon name="flag" size={12} color={dateColor} strokeWidth={2} />}
                <Text style={[styles.metaText, { color: dateColor }]}>{dateInfo!.text}</Text>
              </View>
            )}
            {task.recurrence ? <Icon name="repeat" size={13} color={theme.textTertiary} strokeWidth={2} /> : null}
            {!hideProject && project && (
              <View style={styles.metaItem}>
                <View style={[styles.dot, { backgroundColor: projectHex(project.color) }]} />
                <Text style={[styles.metaText, { color: theme.textSecondary }]} numberOfLines={1}>
                  {project.name}
                </Text>
              </View>
            )}
            {taskLabels.slice(0, 2).map((l) => (
              <Text key={l.id} style={[styles.metaText, { color: projectHex(l.color) }]}>
                @{l.name}
              </Text>
            ))}
            {task.priority === 1 || task.priority === 2 ? (
              <Icon
                name="flag"
                size={13}
                color={task.priority === 1 ? theme.priority1 : theme.priority2}
                fill={task.priority === 1 ? theme.priority1 : theme.priority2}
                strokeWidth={2}
              />
            ) : null}
            {hasComments ? (
              <View style={styles.metaItem}>
                <Icon name="message-square" size={12} color={theme.textTertiary} strokeWidth={2} />
                <Text style={[styles.metaText, { color: theme.textTertiary }]}>{commentCount}</Text>
              </View>
            ) : null}
            {assignee ? (
              <View style={[styles.avatar, { backgroundColor: theme.accentWash, borderColor: theme.accent }]}>
                <Text style={[styles.avatarText, { color: theme.accent }]}>{initials(assignee.name)}</Text>
              </View>
            ) : null}
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
      requireExternalGestureToFail={edgeBack ? edgeBlock : undefined}
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
  body: { flex: 1, gap: 2 },
  title: { fontSize: font.body, fontWeight: font.weightRegular, lineHeight: font.body * 1.25 },
  strike: { textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.s2, flexWrap: 'nowrap' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 160 },
  metaText: { fontSize: font.caption, fontVariant: ['tabular-nums'] },
  dot: { width: 8, height: 8, borderRadius: 4 },
  avatar: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 3,
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
