import { selectList, todayLocalISO } from '@balu/domain';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackHeader } from '../components/StackHeader';
import { TaskItems } from '../components/TaskList';
import { EmptyState } from '../components/ui';
import { useT } from '../i18n';
import { useApp } from '../store/app';
import { useMaps, useSnapshot } from '../store/useSnapshot';
import { useTheme } from '../theme/ThemeProvider';

/** "Assigned to me" smart list (contract §4). Shown only in shared workspaces. */
export default function AssignedScreen() {
  const theme = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const snap = useSnapshot();
  const maps = useMaps(snap);
  const user = useApp((s) => s.user);
  const today = todayLocalISO();

  // Solo workspace or logged out → nothing to show here; bounce back.
  const memberCount = snap.members.filter((m) => !m.is_deleted).length;
  useEffect(() => {
    if (user == null || memberCount <= 1) router.back();
  }, [user, memberCount]);

  const tasks = user ? selectList(snap.tasks, 'assigned', today, user.id) : [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <StackHeader title={t('nav.assigned')} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {tasks.length === 0 ? (
          <EmptyState text={t('empty.assigned')} icon="user-check" />
        ) : (
          <TaskItems tasks={tasks} maps={maps} today={today} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 120 },
});
