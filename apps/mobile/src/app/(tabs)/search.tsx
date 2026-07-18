import { isOpen, todayLocalISO } from '@balu/domain';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderActions } from '../../components/HeaderActions';
import { Icon } from '../../components/Icon';
import { TaskItems } from '../../components/TaskList';
import { EmptyState, ScreenHeader } from '../../components/ui';
import { useT } from '../../i18n';
import { useApp } from '../../store/app';
import { useMaps, useSnapshot } from '../../store/useSnapshot';
import { useTheme } from '../../theme/ThemeProvider';
import { font, gutter, radius, space } from '../../theme/tokens';

export default function SearchScreen() {
  const theme = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const snap = useSnapshot();
  const maps = useMaps(snap);
  const setContext = useApp((s) => s.setContext);
  const today = todayLocalISO();
  const [query, setQuery] = useState('');

  useFocusEffect(useCallback(() => setContext({ kind: 'list', list: 'inbox' }), [setContext]));

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    return snap.tasks
      .filter((task) => isOpen(task) && task.title.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, 100);
  }, [snap.tasks, q]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <ScreenHeader title={t('nav.search')} right={<HeaderActions />} />
      <View style={[styles.searchBar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Icon name="search" size={18} color={theme.textTertiary} strokeWidth={2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('search.placeholder')}
          placeholderTextColor={theme.textTertiary}
          style={[styles.input, { color: theme.textPrimary }]}
          autoCapitalize="none"
          returnKeyType="search"
        />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!q ? (
          <EmptyState text={t('empty.search')} icon="search" />
        ) : results.length === 0 ? (
          <EmptyState text={t('empty.searchNone')} />
        ) : (
          <TaskItems tasks={results} maps={maps} today={today} swipeable={false} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    marginHorizontal: gutter,
    marginBottom: space.s2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: space.s3,
    minHeight: 44,
  },
  input: { flex: 1, fontSize: font.body },
  content: { paddingBottom: 160 },
});
