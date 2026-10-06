import { activeProjects, archivedProjects, canWrite, isOpen, nextSortOrder, reorderUpdates, selectList, todayLocalISO, type Project } from '@balu/domain';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import DraggableFlatList, { type DragEndParams, type RenderItemParams } from 'react-native-draggable-flatlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderActions } from '../../components/HeaderActions';
import { Icon } from '../../components/Icon';
import { MoreButton } from '../../components/MoreButton';
import { Divider, ListRow, ScreenHeader, SectionHeader } from '../../components/ui';
import { addProject, updateProject } from '../../lib/actions';
import { hapticDrop, hapticSelect } from '../../lib/haptics';
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
  const openProjectActions = useApp((s) => s.openProjectActions);
  const today = todayLocalISO();
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  useFocusEffect(useCallback(() => setContext({ kind: 'list', list: 'inbox' }), [setContext]));

  const openCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of snap.tasks) {
      if (!isOpen(task) || task.parent_task_id != null || !task.project_id) continue;
      counts.set(task.project_id, (counts.get(task.project_id) ?? 0) + 1);
    }
    return counts;
  }, [snap.tasks]);

  const inboxCount = selectList(snap.tasks, snap.projects, 'inbox', today).length;
  // "Assigned to me" is only meaningful in a shared workspace (contract §4).
  const members = snap.members.filter((m) => !m.is_deleted);
  const memberCount = members.length;
  const showAssigned = memberCount > 1 && user != null;
  const assignedCount = user ? selectList(snap.tasks, snap.projects, 'assigned', today, user.id).length : 0;
  const myRole = user ? members.find((m) => m.id === user.id)?.role : undefined;
  const writable = canWrite(myRole);
  const projects = activeProjects(snap.projects);
  const archived = archivedProjects(snap.projects);
  const labels = snap.labels.filter((l) => !l.is_deleted).sort((a, b) => a.sort_order - b.sort_order);

  const createProject = () => {
    const name = newName.trim();
    if (name) addProject({ name, color: 'blue', sort_order: nextSortOrder(projects) });
    setNewName('');
    setAdding(false);
  };

  const onProjectDragEnd = ({ data }: DragEndParams<Project>) => {
    const updates = reorderUpdates(projects, data.map((p) => p.id));
    for (const u of updates) updateProject(u.id, { sort_order: u.sort_order });
    if (updates.length > 0) hapticDrop();
  };

  const renderProject = ({ item: p, drag, isActive }: RenderItemParams<Project>) => (
    <View style={isActive ? { backgroundColor: theme.accentWash } : undefined}>
      <ListRow
        colorDot={projectHex(p.color)}
        label={p.name}
        count={openCounts.get(p.id) ?? 0}
        chevron
        onPress={() => router.push({ pathname: '/project/[id]', params: { id: p.id } })}
        onLongPress={writable ? drag : undefined}
        right={writable ? <MoreButton label={t('project.actions')} onPress={() => openProjectActions(p.id)} /> : undefined}
      />
    </View>
  );

  // Header and footer are JSX elements, not inline components: an inline
  // component would remount on every keystroke and the "new project" TextInput
  // would lose focus.
  const header = (
    <View>
      <ListRow icon="inbox" label={t('nav.inbox')} badge={inboxCount} chevron onPress={() => router.push({ pathname: '/list/[list]', params: { list: 'inbox' } })} />
      <ListRow icon="layers" label={t('nav.anytime')} chevron onPress={() => router.push({ pathname: '/list/[list]', params: { list: 'anytime' } })} />
      <ListRow icon="archive" label={t('nav.someday')} chevron onPress={() => router.push({ pathname: '/list/[list]', params: { list: 'someday' } })} />
      <ListRow icon="check-circle" label={t('nav.logbook')} chevron onPress={() => router.push({ pathname: '/list/[list]', params: { list: 'logbook' } })} />
      {showAssigned ? (
        <ListRow icon="user-check" label={t('nav.assigned')} count={assignedCount} chevron onPress={() => router.push('/assigned')} />
      ) : null}

      <SectionHeader>{t('section.projects')}</SectionHeader>
      <Divider />
    </View>
  );

  const footer = (
    <View>
      {writable ? (
        adding ? (
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
        )
      ) : null}

      {archived.length > 0 ? (
        <>
          <Pressable
            onPress={() => setShowArchived((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showArchived }}
            style={styles.archivedToggle}
          >
            <View style={styles.archivedTitle}>
              <SectionHeader numberOfLines={1}>{`${t('project.archivedProjects')} (${archived.length})`}</SectionHeader>
            </View>
            <Icon name={showArchived ? 'chevron-down' : 'chevron-right'} size={16} color={theme.textTertiary} strokeWidth={2} />
          </Pressable>
          {showArchived ? (
            <>
              <Divider />
              {archived.map((p) => (
                <ListRow
                  key={p.id}
                  colorDot={projectHex(p.color)}
                  label={p.name}
                  chevron
                  onPress={() => router.push({ pathname: '/project/[id]', params: { id: p.id } })}
                  right={writable ? <MoreButton label={t('project.actions')} onPress={() => openProjectActions(p.id)} /> : undefined}
                />
              ))}
            </>
          ) : null}
        </>
      ) : null}

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
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
      <ScreenHeader title={t('nav.browse')} right={<HeaderActions />} />
      <DraggableFlatList
        data={projects}
        keyExtractor={(p) => p.id}
        renderItem={renderProject}
        onDragBegin={() => hapticSelect()}
        onDragEnd={onProjectDragEnd}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        containerStyle={styles.list}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { paddingBottom: 160 },
  newProject: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingHorizontal: gutter, paddingVertical: space.s4 },
  newProjectText: { fontSize: font.body, fontWeight: font.weightMedium },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingHorizontal: gutter, paddingVertical: space.s3, borderBottomWidth: StyleSheet.hairlineWidth },
  newDot: { width: 12, height: 12, borderRadius: 6 },
  newInput: { flex: 1, fontSize: font.body },
  archivedToggle: { flexDirection: 'row', alignItems: 'flex-end', paddingRight: gutter },
  archivedTitle: { flex: 1, minWidth: 0 },
});
