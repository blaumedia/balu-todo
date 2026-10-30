import { isOpen, nextProjectSortOrder, todayLocalISO, type Task } from '@balu/domain';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Fab } from '../../components/Fab';
import { Icon } from '../../components/Icon';
import { MoreButton } from '../../components/MoreButton';
import { ProgressRing } from '../../components/ProgressRing';
import { StackHeader } from '../../components/StackHeader';
import { TaskItems } from '../../components/TaskList';
import { EmptyState, SectionHeader } from '../../components/ui';
import { useWritable } from '../../hooks/use-my-role';
import { useT } from '../../i18n';
import { deleteSection, updateProject } from '../../lib/actions';
import { canQuickAddInto, resolveProjectId } from '../../lib/quickadd';
import { useApp } from '../../store/app';
import { useMaps, useSnapshot } from '../../store/useSnapshot';
import { useTheme } from '../../theme/ThemeProvider';
import { font, gutter, projectHex, space } from '../../theme/tokens';

export default function ProjectScreen() {
  const theme = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const snap = useSnapshot();
  const maps = useMaps(snap);
  const today = todayLocalISO();
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  // A project created offline is pushed as /project/tmp-...; once the server acks,
  // the replica holds it under its real id. Follow the alias so the screen (and
  // the compose context set below) keeps pointing at it instead of healing away.
  const id = resolveProjectId(snap.idAliases, routeId);
  const navigation = useNavigation();
  const setContext = useApp((s) => s.setContext);
  const openProjectActions = useApp((s) => s.openProjectActions);
  const openQuickAdd = useApp((s) => s.openQuickAdd);
  const quickAddOpen = useApp((s) => s.quickAddOpen);

  useFocusEffect(useCallback(() => setContext({ kind: 'project', projectId: id }), [setContext, id]));

  const project = snap.projects.find((p) => p.id === id);
  const projectTasks = snap.tasks.filter((x) => x.project_id === id && x.parent_task_id == null && !x.is_deleted);
  const openTasks = projectTasks.filter(isOpen);
  const doneCount = projectTasks.filter((x) => x.completed_at != null).length;

  const sections = snap.sections
    .filter((s) => s.project_id === id && !s.is_deleted)
    .sort((a, b) => a.sort_order - b.sort_order);

  const bySection = (sectionId: string | null): Task[] =>
    openTasks.filter((x) => x.section_id === sectionId).sort((a, b) => a.sort_order - b.sort_order);

  const body = bySection(null);

  const writable = useWritable();

  // Leave the screen once the project is gone: deleted here (the optimistic
  // record stays, flagged is_deleted) or deleted elsewhere (a synced delete is
  // dropped from the replica entirely, so there is no flagged record to see -
  // the project simply stops being found). `seen` remembers the id this screen
  // has actually shown, so a project that has not loaded yet is not gone; the
  // status gate mirrors the web Shell (never act on unconfirmed data);
  // `healed` makes the pop fire once. Held while quick-add is open: the sheet
  // sits over this screen, and popping under it would switch the compose context
  // to Browse's Inbox mid-typing; the sheet's own guard redirects with a notice
  // instead, and the pop follows when it closes.
  const seen = useRef<string | null>(null);
  const healed = useRef(false);
  // Screen-scoped focus in state so the heal effect re-runs when focus returns:
  // going back while another screen sits on top (Settings pushed over the
  // project) would pop that screen instead of leaving this one.
  const [focused, setFocused] = useState(() => navigation.isFocused());
  useEffect(() => {
    const unsubFocus = navigation.addListener('focus', () => setFocused(true));
    const unsubBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      unsubFocus();
      unsubBlur();
    };
  }, [navigation]);
  useEffect(() => {
    if (project && !project.is_deleted) {
      seen.current = id;
      return;
    }
    const gone = project?.is_deleted === true || (seen.current === id && project == null && snap.status === 'synced');
    if (!gone || healed.current || !focused || quickAddOpen) return;
    healed.current = true;
    // The screen's own navigation, not the global router: back must pop this
    // screen, never whatever happens to be on top of it.
    if (navigation.canGoBack()) navigation.goBack();
    else router.replace('/browse');
  }, [project, snap.status, focused, quickAddOpen, id, navigation]);

  const confirmDeleteSection = (sectionId: string) =>
    Alert.alert(t('project.deleteSection'), t('project.deleteSectionConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => deleteSection(sectionId) },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <StackHeader
        title={project?.name ?? ''}
        colorDot={projectHex(project?.color)}
        right={
          <>
            <ProgressRing done={doneCount} total={projectTasks.length} />
            {writable ? <MoreButton label={t('project.actions')} onPress={() => openProjectActions(id)} /> : null}
          </>
        }
      />
      {project?.archived_at != null ? (
        <View style={[styles.archivedBanner, { borderBottomColor: theme.border }]}>
          <Icon name="archive" size={16} color={theme.textTertiary} strokeWidth={2} />
          <Text style={[styles.archivedText, { color: theme.textSecondary }]}>{t('project.archived')}</Text>
          {writable ? (
            <Pressable onPress={() => updateProject(id, { archived_at: null, sort_order: nextProjectSortOrder(snap.projects) })} hitSlop={10} accessibilityRole="button">
              <Text style={[styles.unarchive, { color: theme.accent }]}>{t('project.unarchive')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {openTasks.length === 0 && sections.length === 0 ? (
          <EmptyState text={t('empty.project')} />
        ) : (
          <>
            <TaskItems tasks={body} maps={maps} today={today} hideProject />
            {/* Empty sections stay visible - otherwise a fresh section looks like nothing happened. */}
            {sections.map((section) => (
              <View key={section.id}>
                <View style={styles.sectionRow}>
                  <View style={styles.sectionTitle}>
                    <SectionHeader numberOfLines={1}>{section.name}</SectionHeader>
                  </View>
                  {writable && (
                    <Pressable
                      hitSlop={10}
                      onPress={() => confirmDeleteSection(section.id)}
                      accessibilityRole="button"
                      accessibilityLabel={t('project.deleteSection')}
                      style={({ pressed }) => [styles.sectionDelete, pressed && { opacity: 0.5 }]}
                    >
                      <Icon name="trash-2" size={15} color={theme.textTertiary} strokeWidth={1.75} />
                    </Pressable>
                  )}
                </View>
                <TaskItems tasks={bySection(section.id)} maps={maps} today={today} hideProject />
              </View>
            ))}
          </>
        )}
      </ScrollView>
      {/* Same quick-add as the tabs; the focus effect above already set the
          compose context to this project, so new tasks land here unless the
          text names another #project. Hidden where adding makes no sense
          (see canQuickAddInto). */}
      {canQuickAddInto(project, writable) ? (
        <Fab onPress={openQuickAdd} bottom={insets.bottom + 24} label={t('project.addTask')} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 160 },
  // SectionHeader carries its own gutter/top/bottom padding; the row only lines
  // the trash icon up with the header text block and the list content gutter.
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end' },
  // Shrinkable so a long section name truncates instead of shoving the icon out.
  sectionTitle: { flex: 1, minWidth: 0 },
  sectionDelete: { paddingTop: space.s5, paddingBottom: space.s2, paddingRight: gutter },
  archivedBanner: { flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingHorizontal: gutter, paddingVertical: space.s2, borderBottomWidth: StyleSheet.hairlineWidth },
  archivedText: { flex: 1, fontSize: font.secondary },
  unarchive: { fontSize: font.secondary, fontWeight: font.weightMedium },
});
