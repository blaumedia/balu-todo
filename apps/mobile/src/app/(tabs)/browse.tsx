import { isOpen, nextSortOrder, todayLocalISO } from '@balu/domain';
import { selectList } from '@balu/domain';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderActions } from '../../components/HeaderActions';
import { Icon } from '../../components/Icon';
import { Divider, ListRow, ScreenHeader, SectionHeader } from '../../components/ui';
import { addProject } from '../../lib/actions';
import { useT } from '../../i18n';
import { useApp } from '../../store/app';
import { useSnapshot } from '../../store/useSnapshot';
import { useTheme } from '../../theme/ThemeProvider';
import { font, gutter, projectHex, space } from '../../theme/tokens';

export default function BrowseScreen() {
  const theme = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const snap = useSnapshot();
  const setContext = useApp((s) => s.setContext);
  const user = useApp((s) => s.user);
  const today = todayLocalISO();
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  useFocusEffect(useCallback(() => setContext({ kind: 'list', list: 'inbox' }), [setContext]));

  const openCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of snap.tasks) {
      if (!isOpen(task) || task.parent_task_id != null || !task.project_id) continue;
      counts.set(task.project_id, (counts.get(task.project_id) ?? 0) + 1);
    }
    return counts;
  }, [snap.tasks]);

  const inboxCount = selectList(snap.tasks, 'inbox', today).length;
  // "Assigned to me" is only meaningful in a shared workspace (contract §4).
  const memberCount = snap.members.filter((m) => !m.is_deleted).length;
  const showAssigned = memberCount > 1 && user != null;
  const assignedCount = user ? selectList(snap.tasks, 'assigned', today, user.id).length : 0;
  const projects = snap.projects.filter((p) => !p.is_deleted && p.archived_at == null).sort((a, b) => a.sort_order - b.sort_order);
  const labels = snap.labels.filter((l) => !l.is_deleted).sort((a, b) => a.sort_order - b.sort_order);

  const createProject = () => {
    const name = newName.trim();
    if (name) addProject({ name, color: 'blue', sort_order: nextSortOrder(projects) });
    setNewName('');
    setAdding(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <ScreenHeader title={t('nav.browse')} right={<HeaderActions />} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <ListRow icon="inbox" label={t('nav.inbox')} badge={inboxCount} chevron onPress={() => router.push({ pathname: '/list/[list]', params: { list: 'inbox' } })} />
        <ListRow icon="layers" label={t('nav.anytime')} chevron onPress={() => router.push({ pathname: '/list/[list]', params: { list: 'anytime' } })} />
        <ListRow icon="archive" label={t('nav.someday')} chevron onPress={() => router.push({ pathname: '/list/[list]', params: { list: 'someday' } })} />
        <ListRow icon="check-circle" label={t('nav.logbook')} chevron onPress={() => router.push({ pathname: '/list/[list]', params: { list: 'logbook' } })} />
        {showAssigned ? (
          <ListRow icon="user-check" label={t('nav.assigned')} count={assignedCount} chevron onPress={() => router.push('/assigned')} />
        ) : null}

        <SectionHeader>{t('section.projects')}</SectionHeader>
        <Divider />
        {projects.map((p) => (
          <ListRow
            key={p.id}
            colorDot={projectHex(p.color)}
            label={p.name}
            count={openCounts.get(p.id) ?? 0}
            chevron
            onPress={() => router.push({ pathname: '/project/[id]', params: { id: p.id } })}
          />
        ))}
        {adding ? (
          <View style={[styles.addRow, { borderBottomColor: theme.border }]}>
            <View style={[styles.newDot, { backgroundColor: projectHex('blue') }]} />
            <TextInput
              autoFocus
              value={newName}
              onChangeText={setNewName}
              onSubmitEditing={createProject}
              onBlur={createProject}
              placeholder={t('project.newProjectName')}
              placeholderTextColor={theme.textTertiary}
              style={[styles.newInput, { color: theme.textPrimary }]}
              returnKeyType="done"
            />
          </View>
        ) : (
          <Pressable onPress={() => setAdding(true)} style={styles.newProject}>
            <Icon name="plus" size={18} color={theme.accent} strokeWidth={2} />
            <Text style={[styles.newProjectText, { color: theme.accent }]}>{t('project.newProject')}</Text>
          </Pressable>
        )}

        {labels.length > 0 ? (
          <>
            <SectionHeader>{t('section.labels')}</SectionHeader>
            <Divider />
            {labels.map((l) => (
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 160 },
  newProject: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingHorizontal: gutter, paddingVertical: space.s4 },
  newProjectText: { fontSize: font.body, fontWeight: font.weightMedium },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingHorizontal: gutter, paddingVertical: space.s3, borderBottomWidth: StyleSheet.hairlineWidth },
  newDot: { width: 12, height: 12, borderRadius: 6 },
  newInput: { flex: 1, fontSize: font.body },
});
