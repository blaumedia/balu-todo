import type { Priority, Task } from '@balu/domain';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { Checkbox } from '../components/Checkbox';
import { Icon } from '../components/Icon';
import { DateField } from './DateField';
import { completeTask, deleteTask, moveTask, uncompleteTask, updateTask } from '../lib/actions';
import { useT } from '../i18n';
import { useApp } from '../store/app';
import { useSnapshot } from '../store/useSnapshot';
import { useTheme } from '../theme/ThemeProvider';
import { font, projectHex, radius, space } from '../theme/tokens';

const RECURRENCE_OPTIONS: { label: string; value: string | null }[] = [
  { label: '—', value: null },
  { label: 'FREQ=DAILY', value: 'FREQ=DAILY' },
  { label: 'FREQ=WEEKLY', value: 'FREQ=WEEKLY' },
  { label: 'FREQ=MONTHLY', value: 'FREQ=MONTHLY' },
  { label: 'FREQ=YEARLY', value: 'FREQ=YEARLY' },
];

export function TaskDetailSheet() {
  const theme = useTheme();
  const { t } = useT();
  const taskId = useApp((s) => s.detailTaskId);
  const close = useApp((s) => s.closeDetail);
  const snap = useSnapshot();
  const task = taskId ? snap.tasks.find((x) => x.id === taskId) : undefined;

  return (
    <BottomSheet visible={taskId != null && task != null} onClose={close} full>
      {task ? <DetailBody key={task.id} task={task} onClose={close} theme={theme} t={t} snap={snap} /> : null}
    </BottomSheet>
  );
}

function DetailBody({
  task,
  onClose,
  theme,
  t,
  snap,
}: {
  task: Task;
  onClose: () => void;
  theme: ReturnType<typeof useTheme>;
  t: ReturnType<typeof useT>['t'];
  snap: ReturnType<typeof useSnapshot>;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [showProjects, setShowProjects] = useState(false);
  const [showRecurrence, setShowRecurrence] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    setNotes(task.notes);
  }, [task.id, task.title, task.notes]);

  const completed = task.completed_at != null;
  const project = task.project_id ? snap.projects.find((p) => p.id === task.project_id) : undefined;

  const commitTitle = () => {
    const v = title.trim();
    if (v && v !== task.title) updateTask(task.id, { title: v });
  };
  const commitNotes = () => {
    if (notes !== task.notes) updateTask(task.id, { notes });
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {/* Title row */}
      <View style={styles.titleRow}>
        <Checkbox
          checked={completed}
          priority={task.priority}
          onToggle={() => (completed ? uncompleteTask(task.id) : completeTask(task.id))}
        />
        <TextInput
          value={title}
          onChangeText={setTitle}
          onBlur={commitTitle}
          style={[styles.titleInput, { color: theme.textPrimary }]}
          multiline
        />
      </View>

      {/* Dates */}
      <DateField
        icon="calendar"
        label={t('detail.startDate')}
        value={task.start_date}
        onChange={(v) => updateTask(task.id, v == null ? { start_date: null } : { start_date: v, someday: false })}
      />
      <DateField
        icon="flag"
        label={t('detail.deadline')}
        value={task.deadline}
        onChange={(v) => updateTask(task.id, { deadline: v })}
      />

      {/* Evening / Someday toggles */}
      <ToggleRow
        icon="sunset"
        label={t('detail.evening')}
        value={task.evening}
        onValueChange={(v) => updateTask(task.id, { evening: v })}
        theme={theme}
      />
      <ToggleRow
        icon="archive"
        label={t('detail.someday')}
        value={task.someday}
        onValueChange={(v) => updateTask(task.id, v ? { someday: true, start_date: null } : { someday: false })}
        theme={theme}
      />

      {/* Priority */}
      <View style={[styles.row, { borderBottomColor: theme.border }]}>
        <Icon name="flag" size={20} color={theme.textTertiary} strokeWidth={2} />
        <Text style={[styles.label, { color: theme.textSecondary }]}>{t('detail.priority')}</Text>
        <View style={styles.segment}>
          {([0, 1, 2, 3] as Priority[]).map((p) => {
            const active = task.priority === p;
            const color = p === 1 ? theme.priority1 : p === 2 ? theme.priority2 : p === 3 ? theme.priority3 : theme.textTertiary;
            return (
              <Pressable
                key={p}
                onPress={() => updateTask(task.id, { priority: p })}
                style={[styles.segBtn, { borderColor: active ? color : theme.border, backgroundColor: active ? color + '22' : 'transparent' }]}
              >
                <Text style={[styles.segText, { color: active ? color : theme.textTertiary }]}>
                  {p === 0 ? t('detail.none') : `P${p}`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Project move */}
      <Pressable style={[styles.row, { borderBottomColor: theme.border }]} onPress={() => setShowProjects((s) => !s)}>
        <Icon name="hash" size={20} color={theme.textTertiary} strokeWidth={2} />
        <Text style={[styles.label, { color: theme.textSecondary }]}>{t('detail.project')}</Text>
        <View style={styles.value}>
          {project ? <View style={[styles.dot, { backgroundColor: projectHex(project.color) }]} /> : null}
          <Text style={[styles.valueText, { color: theme.textPrimary }]}>{project ? project.name : t('detail.noProject')}</Text>
          <Icon name={showProjects ? 'chevron-down' : 'chevron-right'} size={16} color={theme.textTertiary} strokeWidth={2} />
        </View>
      </Pressable>
      {showProjects ? (
        <View style={styles.subList}>
          <SubOption
            label={t('detail.noProject')}
            active={task.project_id == null}
            onPress={() => {
              moveTask(task.id, { project_id: null });
              setShowProjects(false);
            }}
            theme={theme}
          />
          {snap.projects
            .filter((p) => !p.is_deleted && p.archived_at == null)
            .map((p) => (
              <SubOption
                key={p.id}
                label={p.name}
                dot={projectHex(p.color)}
                active={task.project_id === p.id}
                onPress={() => {
                  moveTask(task.id, { project_id: p.id });
                  setShowProjects(false);
                }}
                theme={theme}
              />
            ))}
        </View>
      ) : null}

      {/* Recurrence */}
      <Pressable style={[styles.row, { borderBottomColor: theme.border }]} onPress={() => setShowRecurrence((s) => !s)}>
        <Icon name="repeat" size={20} color={theme.textTertiary} strokeWidth={2} />
        <Text style={[styles.label, { color: theme.textSecondary }]}>{t('detail.recurrence')}</Text>
        <View style={styles.value}>
          <Text style={[styles.valueText, { color: task.recurrence ? theme.textPrimary : theme.textTertiary }]}>
            {task.recurrence ?? t('detail.none')}
          </Text>
          <Icon name={showRecurrence ? 'chevron-down' : 'chevron-right'} size={16} color={theme.textTertiary} strokeWidth={2} />
        </View>
      </Pressable>
      {showRecurrence ? (
        <View style={styles.subList}>
          {RECURRENCE_OPTIONS.map((o) => (
            <SubOption
              key={o.label}
              label={o.value ?? t('detail.none')}
              active={(task.recurrence ?? null) === o.value}
              onPress={() => {
                updateTask(task.id, { recurrence: o.value });
                setShowRecurrence(false);
              }}
              theme={theme}
            />
          ))}
        </View>
      ) : null}

      {/* Labels */}
      {snap.labels.length > 0 ? (
        <View style={[styles.labelsRow, { borderBottomColor: theme.border }]}>
          <Icon name="tag" size={20} color={theme.textTertiary} strokeWidth={2} />
          <View style={styles.labelChips}>
            {snap.labels
              .filter((l) => !l.is_deleted)
              .map((l) => {
                const active = task.label_ids.includes(l.id);
                const color = projectHex(l.color);
                return (
                  <Pressable
                    key={l.id}
                    onPress={() => {
                      const next = active ? task.label_ids.filter((x) => x !== l.id) : [...task.label_ids, l.id];
                      updateTask(task.id, { label_ids: next });
                    }}
                    style={[styles.chip, { borderColor: active ? color : theme.border, backgroundColor: active ? color + '22' : 'transparent' }]}
                  >
                    <Text style={[styles.chipText, { color: active ? color : theme.textSecondary }]}>@{l.name}</Text>
                  </Pressable>
                );
              })}
          </View>
        </View>
      ) : null}

      {/* Notes */}
      <TextInput
        value={notes}
        onChangeText={setNotes}
        onBlur={commitNotes}
        placeholder={t('detail.notesPlaceholder')}
        placeholderTextColor={theme.textTertiary}
        style={[styles.notes, { color: theme.textPrimary }]}
        multiline
      />

      {/* Delete */}
      <Pressable
        style={styles.delete}
        onPress={() => {
          deleteTask(task.id);
          onClose();
        }}
      >
        <Icon name="trash-2" size={18} color={theme.danger} strokeWidth={2} />
        <Text style={[styles.deleteText, { color: theme.danger }]}>{t('detail.delete')}</Text>
      </Pressable>
      <View style={{ height: space.s8 }} />
    </ScrollView>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  onValueChange,
  theme,
}: {
  icon: 'sunset' | 'archive';
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Icon name={icon} size={20} color={theme.textTertiary} strokeWidth={2} />
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      <Switch
        style={styles.switch}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: theme.accent, false: theme.border }}
        thumbColor="#fff"
      />
    </View>
  );
}

function SubOption({
  label,
  dot,
  active,
  onPress,
  theme,
}: {
  label: string;
  dot?: string;
  active: boolean;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.subOpt, pressed && { backgroundColor: theme.accentWash }]}>
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : <View style={styles.dotSpacer} />}
      <Text style={[styles.subText, { color: active ? theme.accent : theme.textPrimary }]} numberOfLines={1}>
        {label}
      </Text>
      {active ? <Icon name="check" size={16} color={theme.accent} strokeWidth={2.5} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s3, paddingVertical: space.s2 },
  titleInput: { flex: 1, fontSize: font.title, fontWeight: font.weightSemibold, paddingTop: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingVertical: space.s3, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: font.secondary },
  value: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: space.s2, flexShrink: 1 },
  valueText: { fontSize: font.secondary },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotSpacer: { width: 10, height: 10 },
  segment: { marginLeft: 'auto', flexDirection: 'row', gap: 6 },
  segBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.chip, borderWidth: 1 },
  segText: { fontSize: font.caption, fontWeight: font.weightSemibold },
  subList: { paddingLeft: space.s8, paddingBottom: space.s2 },
  subOpt: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingVertical: space.s2, borderRadius: 8, paddingHorizontal: space.s2 },
  subText: { fontSize: font.secondary, flex: 1 },
  switch: { marginLeft: 'auto' },
  labelsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s3, paddingVertical: space.s3, borderBottomWidth: StyleSheet.hairlineWidth },
  labelChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  chipText: { fontSize: font.caption, fontWeight: font.weightMedium },
  notes: { fontSize: font.body, paddingTop: space.s4, minHeight: 80, lineHeight: font.body * 1.4 },
  delete: { flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingVertical: space.s4 },
  deleteText: { fontSize: font.body, fontWeight: font.weightMedium },
});
