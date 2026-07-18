import { todayLocalISO } from '@balu/domain';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderActions } from '../../components/HeaderActions';
import { Icon } from '../../components/Icon';
import { TaskItems } from '../../components/TaskList';
import { EmptyState, ListRow, ScreenHeader, SectionHeader } from '../../components/ui';
import { searchReplica } from '../../lib/search';
import { useT } from '../../i18n';
import { useApp } from '../../store/app';
import { useMaps, useSnapshot } from '../../store/useSnapshot';
import { useTheme } from '../../theme/ThemeProvider';
import { font, gutter, projectHex, radius, space } from '../../theme/tokens';

export default function SearchScreen() {
  const theme = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const snap = useSnapshot();
  const maps = useMaps(snap);
  const setContext = useApp((s) => s.setContext);
  const today = todayLocalISO();
  const [query, setQuery] = useState('');
  const [includeCompleted, setIncludeCompleted] = useState(false);

  useFocusEffect(useCallback(() => setContext({ kind: 'list', list: 'inbox' }), [setContext]));

  const q = query.trim();
  const results = useMemo(
    () =>
      searchReplica({
        tasks: snap.tasks,
        projects: snap.projects,
        labels: snap.labels,
        query: q,
        includeCompleted,
      }),
    [snap.tasks, snap.projects, snap.labels, q, includeCompleted],
  );

  const hasResults = results.tasks.length > 0 || results.projects.length > 0 || results.labels.length > 0;

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

      {q ? (
        <Pressable
          onPress={() => setIncludeCompleted((v) => !v)}
          style={[
            styles.toggle,
            {
              borderColor: includeCompleted ? theme.accent : theme.border,
              backgroundColor: includeCompleted ? theme.accentWash : 'transparent',
            },
          ]}
        >
          <Icon
            name={includeCompleted ? 'check-circle' : 'circle'}
            size={16}
            color={includeCompleted ? theme.accent : theme.textTertiary}
            strokeWidth={2}
          />
          <Text style={[styles.toggleText, { color: includeCompleted ? theme.accent : theme.textSecondary }]}>
            {t('search.showCompleted')}
          </Text>
        </Pressable>
      ) : null}

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!q ? (
          <EmptyState text={t('empty.search')} icon="search" />
        ) : !hasResults ? (
          <EmptyState text={t('empty.searchNone')} />
        ) : (
          <>
            {results.tasks.length > 0 ? (
              <>
                <SectionHeader>{t('search.tasks')}</SectionHeader>
                <TaskItems tasks={results.tasks} maps={maps} today={today} swipeable={false} />
              </>
            ) : null}

            {results.projects.length > 0 ? (
              <>
                <SectionHeader>{t('section.projects')}</SectionHeader>
                {results.projects.map((p) => (
                  <ListRow
                    key={p.id}
                    colorDot={projectHex(p.color)}
                    label={p.name}
                    chevron
                    onPress={() => router.push({ pathname: '/project/[id]', params: { id: p.id } })}
                  />
                ))}
              </>
            ) : null}

            {results.labels.length > 0 ? (
              <>
                <SectionHeader>{t('section.labels')}</SectionHeader>
                {results.labels.map((l) => (
                  <ListRow
                    key={l.id}
                    icon="tag"
                    label={l.name}
                    chevron
                    onPress={() => router.push({ pathname: '/label/[id]', params: { id: l.id } })}
                  />
                ))}
              </>
            ) : null}
          </>
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
  toggle: {
    alignSelf: 'flex-start',
    marginHorizontal: gutter,
    marginBottom: space.s2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.s3,
    paddingVertical: space.s1,
  },
  toggleText: { fontSize: font.caption, fontWeight: font.weightMedium },
  content: { paddingBottom: 160 },
});
