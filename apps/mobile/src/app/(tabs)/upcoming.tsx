import { selectList, todayLocalISO, upcomingGroupDate, type IsoDate, type Task } from '@balu/domain';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState, ScreenHeader, SectionHeader } from '../../components/ui';
import { HeaderActions } from '../../components/HeaderActions';
import { TaskItems } from '../../components/TaskList';
import { dayMonth, weekdayLong } from '../../lib/format';
import { useT } from '../../i18n';
import { useApp } from '../../store/app';
import { useMaps, useSnapshot } from '../../store/useSnapshot';
import { useTheme } from '../../theme/ThemeProvider';

export default function UpcomingScreen() {
  const theme = useTheme();
  const { t, locale } = useT();
  const insets = useSafeAreaInsets();
  const snap = useSnapshot();
  const maps = useMaps(snap);
  const setContext = useApp((s) => s.setContext);
  const today = todayLocalISO();

  useFocusEffect(useCallback(() => setContext({ kind: 'list', list: 'upcoming' }), [setContext]));

  const tasks = selectList(snap.tasks, 'upcoming', today);

  // Preserve the contract ordering; bucket into consecutive date groups.
  const groups: { date: IsoDate; items: Task[] }[] = [];
  for (const task of tasks) {
    const date = upcomingGroupDate(task, today);
    if (!date) continue;
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.items.push(task);
    else groups.push({ date, items: [task] });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <ScreenHeader title={t('nav.upcoming')} right={<HeaderActions />} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {groups.length === 0 ? (
          <EmptyState text={t('empty.upcoming')} icon="calendar" />
        ) : (
          groups.map((g) => (
            <View key={g.date}>
              <SectionHeader>{`${weekdayLong(g.date, locale)} · ${dayMonth(g.date, locale)}`}</SectionHeader>
              <TaskItems tasks={g.items} maps={maps} today={today} />
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 160 },
});
