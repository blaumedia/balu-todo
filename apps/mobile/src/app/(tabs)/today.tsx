import { selectList, todayLocalISO } from '@balu/domain';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState, ScreenHeader, SectionHeader } from '../../components/ui';
import { HeaderActions } from '../../components/HeaderActions';
import { TaskItems } from '../../components/TaskList';
import { useT } from '../../i18n';
import { useApp } from '../../store/app';
import { useMaps, useSnapshot } from '../../store/useSnapshot';
import { useTheme } from '../../theme/ThemeProvider';

export default function TodayScreen() {
  const theme = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const snap = useSnapshot();
  const maps = useMaps(snap);
  const setContext = useApp((s) => s.setContext);
  const today = todayLocalISO();

  useFocusEffect(useCallback(() => setContext({ kind: 'list', list: 'today' }), [setContext]));

  const all = selectList(snap.tasks, 'today', today);
  const day = all.filter((x) => !x.evening);
  const evening = all.filter((x) => x.evening);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <ScreenHeader title={t('nav.today')} right={<HeaderActions />} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {all.length === 0 ? (
          <EmptyState text={t('empty.today')} icon="star" />
        ) : (
          <>
            <TaskItems tasks={day} maps={maps} today={today} />
            {evening.length > 0 ? (
              <>
                <SectionHeader>{t('section.thisEvening')}</SectionHeader>
                <TaskItems tasks={evening} maps={maps} today={today} />
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 160 },
});
