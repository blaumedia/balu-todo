import { canWrite, isOpen, todayLocalISO, type Task } from '@balu/domain';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../../components/Icon';
import { ProgressRing } from '../../components/ProgressRing';
import { StackHeader } from '../../components/StackHeader';
import { TaskItems } from '../../components/TaskList';
import { EmptyState, SectionHeader } from '../../components/ui';
import { useT } from '../../i18n';
import { deleteSection } from '../../lib/actions';
import { useApp } from '../../store/app';
import { useMaps, useSnapshot } from '../../store/useSnapshot';
import { useTheme } from '../../theme/ThemeProvider';
import { gutter, projectHex, space } from '../../theme/tokens';

export default function ProjectScreen() {
  const theme = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const snap = useSnapshot();
  const maps = useMaps(snap);
  const today = todayLocalISO();
  const { id } = useLocalSearchParams<{ id: string }>();
  const setContext = useApp((s) => s.setContext);
  const user = useApp((s) => s.user);

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

  const members = snap.members.filter((m) => !m.is_deleted);
  const myRole = user ? members.find((m) => m.id === user.id)?.role : undefined;
  const writable = canWrite(myRole);

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
        right={<ProgressRing done={doneCount} total={projectTasks.length} />}
      />
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
});
