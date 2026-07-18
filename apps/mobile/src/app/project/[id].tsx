import { isOpen, todayLocalISO, type Task } from '@balu/domain';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProgressRing } from '../../components/ProgressRing';
import { StackHeader } from '../../components/StackHeader';
import { TaskItems } from '../../components/TaskList';
import { EmptyState, SectionHeader } from '../../components/ui';
import { useT } from '../../i18n';
import { useApp } from '../../store/app';
import { useMaps, useSnapshot } from '../../store/useSnapshot';
import { useTheme } from '../../theme/ThemeProvider';
import { projectHex } from '../../theme/tokens';

export default function ProjectScreen() {
  const theme = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const snap = useSnapshot();
  const maps = useMaps(snap);
  const today = todayLocalISO();
  const { id } = useLocalSearchParams<{ id: string }>();
  const setContext = useApp((s) => s.setContext);

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

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <StackHeader
        title={project?.name ?? ''}
        colorDot={projectHex(project?.color)}
        right={<ProgressRing done={doneCount} total={projectTasks.length} />}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {openTasks.length === 0 ? (
          <EmptyState text={t('empty.project')} />
        ) : (
          <>
            <TaskItems tasks={body} maps={maps} today={today} hideProject />
            {sections.map((section) => {
              const items = bySection(section.id);
              if (items.length === 0) return null;
              return (
                <View key={section.id}>
                  <SectionHeader>{section.name}</SectionHeader>
                  <TaskItems tasks={items} maps={maps} today={today} hideProject />
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 160 },
});
