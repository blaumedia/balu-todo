import { selectList, todayLocalISO, type SmartList, type Task } from '@balu/domain';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackHeader } from '../../components/StackHeader';
import { TaskItems } from '../../components/TaskList';
import { EmptyState, SectionHeader } from '../../components/ui';
import { monthLong, weekdayLong } from '../../lib/format';
import { useT, type TranslationKey } from '../../i18n';
import { useMaps, useSnapshot } from '../../store/useSnapshot';
import { useTheme } from '../../theme/ThemeProvider';

const VALID: SmartList[] = ['inbox', 'anytime', 'someday', 'logbook'];
const NAV: Record<string, TranslationKey> = {
  inbox: 'nav.inbox',
  anytime: 'nav.anytime',
  someday: 'nav.someday',
  logbook: 'nav.logbook',
};
const EMPTY: Record<string, TranslationKey> = {
  inbox: 'empty.inbox',
  anytime: 'empty.anytime',
  someday: 'empty.someday',
  logbook: 'empty.logbook',
};

export default function ListScreen() {
  const theme = useTheme();
  const { t, locale } = useT();
  const insets = useSafeAreaInsets();
  const snap = useSnapshot();
  const maps = useMaps(snap);
  const today = todayLocalISO();

  const { list: raw } = useLocalSearchParams<{ list: string }>();
  const list: SmartList = VALID.includes(raw as SmartList) ? (raw as SmartList) : 'inbox';
  const tasks = selectList(snap.tasks, list, today);

  // Logbook groups by completion day (contract §4).
  const groups: { key: string; label: string; items: Task[] }[] = [];
  if (list === 'logbook') {
    for (const task of tasks) {
      const day = (task.completed_at ?? '').slice(0, 10);
      const last = groups[groups.length - 1];
      if (last && last.key === day) last.items.push(task);
      else groups.push({ key: day, label: day ? `${weekdayLong(day, locale)} · ${monthLong(day, locale)}` : '', items: [task] });
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <StackHeader title={t(NAV[list])} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {tasks.length === 0 ? (
          <EmptyState text={t(EMPTY[list])} />
        ) : list === 'logbook' ? (
          groups.map((g) => (
            <View key={g.key}>
              <SectionHeader>{g.label}</SectionHeader>
              <TaskItems tasks={g.items} maps={maps} today={today} swipeable={false} />
            </View>
          ))
        ) : (
          <TaskItems tasks={tasks} maps={maps} today={today} hideProject={list === 'anytime' ? false : undefined} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },
});
