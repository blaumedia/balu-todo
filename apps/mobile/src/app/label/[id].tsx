import { isOpen, todayLocalISO } from '@balu/domain';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackHeader } from '../../components/StackHeader';
import { TaskItems } from '../../components/TaskList';
import { EmptyState } from '../../components/ui';
import { useMaps, useSnapshot } from '../../store/useSnapshot';
import { useTheme } from '../../theme/ThemeProvider';
import { projectHex } from '../../theme/tokens';

export default function LabelScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const snap = useSnapshot();
  const maps = useMaps(snap);
  const today = todayLocalISO();
  const { id } = useLocalSearchParams<{ id: string }>();

  const label = snap.labels.find((l) => l.id === id);
  const tasks = snap.tasks
    .filter((x) => isOpen(x) && x.parent_task_id == null && x.label_ids.includes(id))
    .sort((a, b) => a.sort_order - b.sort_order);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <StackHeader title={label ? `@${label.name}` : ''} colorDot={projectHex(label?.color)} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {tasks.length === 0 ? <EmptyState text="—" icon="tag" /> : <TaskItems tasks={tasks} maps={maps} today={today} />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 160 },
});
