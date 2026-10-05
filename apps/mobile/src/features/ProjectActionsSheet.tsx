import { PROJECT_COLORS, canWrite, type Project } from '@balu/domain';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { Title } from '../components/Title';
import { deleteProject, updateProject } from '../lib/actions';
import { useT, type TranslationKey } from '../i18n';
import { useApp } from '../store/app';
import { useSnapshot } from '../store/useSnapshot';
import { useTheme } from '../theme/ThemeProvider';
import { font, hit, projectHex, radius, space } from '../theme/tokens';

type Mode = 'menu' | 'rename' | 'color';

export function ProjectActionsSheet() {
  const theme = useTheme();
  const { t } = useT();
  const projectId = useApp((s) => s.projectActionsId);
  const close = useApp((s) => s.closeProjectActions);
  const user = useApp((s) => s.user);
  const snap = useSnapshot();
  const project: Project | undefined = projectId ? snap.projects.find((p) => p.id === projectId && !p.is_deleted) : undefined;
  const myRole = user ? snap.members.find((m) => m.id === user.id && !m.is_deleted)?.role : undefined;
  const writable = canWrite(myRole);
  const [mode, setMode] = useState<Mode>('menu');
  const [name, setName] = useState('');

  // Every open starts on the menu with the current name; only the id matters,
  // a remote rename while the sheet is open must not clobber what is typed.
  useEffect(() => {
    setMode('menu');
    setName(project?.name ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // The project can vanish remotely (deleted on another client) while the
  // sheet is open; close and clear the store id so it does not dangle.
  useEffect(() => {
    if (projectId && !project) close();
  }, [projectId, project, close]);

  const visible = projectId != null && project != null && writable;

  let body: ReactNode = null;
  if (project) {
    if (mode === 'rename') {
      const saveRename = () => {
        const trimmed = name.trim();
        if (trimmed && trimmed !== project.name) updateProject(project.id, { name: trimmed });
        close();
      };
      body = (
        <>
          <Title>{t('project.rename')}</Title>
          <TextInput
            autoFocus
            selectTextOnFocus
            value={name}
            onChangeText={setName}
            onSubmitEditing={saveRename}
            returnKeyType="done"
            placeholder={t('project.newProjectName')}
            placeholderTextColor={theme.textTertiary}
            style={[styles.input, { color: theme.textPrimary, borderColor: theme.border, backgroundColor: theme.surface }]}
          />
          <View style={styles.buttons}>
            <Button title={t('common.cancel')} variant="secondary" onPress={() => setMode('menu')} style={styles.button} />
            <Button title={t('common.save')} onPress={saveRename} disabled={!name.trim()} style={styles.button} />
          </View>
        </>
      );
    } else if (mode === 'color') {
      body = (
        <>
          <Title>{t('project.color')}</Title>
          <View style={styles.swatches}>
            {PROJECT_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => { updateProject(project.id, { color: c }); close(); }}
                accessibilityRole="button"
                accessibilityLabel={c}
                accessibilityState={{ selected: c === project.color }}
                style={({ pressed }) => [styles.swatch, { backgroundColor: projectHex(c) }, pressed && { opacity: 0.7 }]}
              >
                {c === project.color ? <Icon name="check" size={20} color="#fff" strokeWidth={3} /> : null}
              </Pressable>
            ))}
          </View>
        </>
      );
    } else {
      const archived = project.archived_at != null;
      const confirmDelete = () =>
        Alert.alert(t('project.delete'), t('project.deleteConfirm'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.delete'), style: 'destructive', onPress: () => { deleteProject(project.id); close(); } },
        ]);
      const options: { key: TranslationKey; icon: IconName; run: () => void; tint?: string }[] = [
        { key: 'project.rename', icon: 'pencil', run: () => setMode('rename') },
        { key: 'project.color', icon: 'palette', run: () => setMode('color') },
        archived
          ? { key: 'project.unarchive', icon: 'archive-restore', run: () => { updateProject(project.id, { archived_at: null }); close(); } }
          : { key: 'project.archive', icon: 'archive', run: () => { updateProject(project.id, { archived_at: new Date().toISOString() }); close(); } },
        { key: 'project.delete', icon: 'trash-2', run: confirmDelete, tint: theme.danger },
      ];
      body = (
        <>
          <Title>{project.name}</Title>
          <View style={styles.list}>
            {options.map((o) => (
              <Pressable
                key={o.key}
                onPress={o.run}
                style={({ pressed }) => [styles.opt, pressed && { backgroundColor: theme.accentWash }]}
              >
                <Icon name={o.icon} size={20} color={o.tint ?? theme.textSecondary} strokeWidth={2} />
                <Text style={[styles.optLabel, { color: o.tint ?? theme.textPrimary }]}>{t(o.key)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      );
    }
  }

  return (
    <BottomSheet visible={visible} onClose={close}>
      {project ? body : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { paddingTop: space.s2 },
  opt: { minHeight: hit, flexDirection: 'row', alignItems: 'center', gap: space.s4, paddingVertical: space.s3, paddingHorizontal: space.s1, borderRadius: 8 },
  optLabel: { fontSize: font.body },
  input: { height: hit, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.control, paddingHorizontal: space.s3, fontSize: font.body, marginTop: space.s2 },
  buttons: { flexDirection: 'row', gap: space.s3, paddingTop: space.s4 },
  button: { flex: 1 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s3, paddingVertical: space.s3 },
  swatch: { width: hit, height: hit, borderRadius: hit / 2, alignItems: 'center', justifyContent: 'center' },
});
