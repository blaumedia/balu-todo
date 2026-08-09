import type { Comment, Priority, Role, Task } from '@balu/domain';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { Checkbox } from '../components/Checkbox';
import { Icon } from '../components/Icon';
import { DateField } from './DateField';
import { ReminderField } from './ReminderField';
import {
  addComment,
  completeTask,
  deleteComment,
  deleteTask,
  moveTask,
  uncompleteTask,
  updateComment,
  updateTask,
} from '../lib/actions';
import {
  canComment,
  canDeleteComment,
  canEditComment,
  commentsForTask,
  initials,
} from '../lib/collab';
import { relativeTime } from '../lib/format';
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
  const [showSections, setShowSections] = useState(false);
  const [showRecurrence, setShowRecurrence] = useState(false);
  const [showAssignee, setShowAssignee] = useState(false);
  const user = useApp((s) => s.user);

  useEffect(() => {
    setTitle(task.title);
    setNotes(task.notes);
  }, [task.id, task.title, task.notes]);

  const completed = task.completed_at != null;
  const project = task.project_id ? snap.projects.find((p) => p.id === task.project_id) : undefined;
  const sections = task.project_id
    ? snap.sections
        .filter((s) => !s.is_deleted && s.project_id === task.project_id)
        .sort((a, b) => a.sort_order - b.sort_order)
    : [];
  const section = task.section_id ? sections.find((s) => s.id === task.section_id) : undefined;

  const members = snap.members.filter((m) => !m.is_deleted);
  const multiMember = members.length > 1;
  const assignee = task.assigned_to ? members.find((m) => m.id === task.assigned_to) : undefined;
  const myRole: Role | undefined = user ? members.find((m) => m.id === user.id)?.role : undefined;
  const writable = myRole != null && myRole !== 'viewer';
  const scrollRef = useRef<ScrollView>(null);
  // The composer sits at the sheet's bottom — when it gains focus the keyboard
  // pads the sheet, but the ScrollView doesn't follow on its own.
  const scrollToComposer = () => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300);
  };

  const commitTitle = () => {
    const v = title.trim();
    if (v && v !== task.title) updateTask(task.id, { title: v });
  };
  const commitNotes = () => {
    if (notes !== task.notes) updateTask(task.id, { notes });
  };

  return (
    <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {/* Title row */}
      <View style={styles.titleRow}>
        <Checkbox
          checked={completed}
          priority={task.priority}
          onToggle={() => writable && (completed ? uncompleteTask(task.id) : completeTask(task.id))}
        />
        <TextInput
          value={title}
          editable={writable}
          onChangeText={setTitle}
          onBlur={commitTitle}
          style={[styles.titleInput, { color: theme.textPrimary }]}
          multiline
        />
      </View>

      {/* Editable fields — inert for read-only viewers (server enforces too) */}
      <View pointerEvents={writable ? 'auto' : 'none'}>
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

      {/* Reminder — writes reminder_at (drives local notifications) */}
      <ReminderField
        value={task.reminder_at}
        onChange={(v) => updateTask(task.id, { reminder_at: v })}
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

      {/* Section move - within the current project only */}
      {sections.length > 0 ? (
        <>
          <Pressable style={[styles.row, { borderBottomColor: theme.border }]} onPress={() => setShowSections((s) => !s)}>
            <Icon name="layers" size={20} color={theme.textTertiary} strokeWidth={2} />
            <Text style={[styles.label, { color: theme.textSecondary }]}>{t('detail.section')}</Text>
            <View style={styles.value}>
              <Text style={[styles.valueText, { color: section ? theme.textPrimary : theme.textTertiary }]}>
                {section ? section.name : t('detail.noSection')}
              </Text>
              <Icon name={showSections ? 'chevron-down' : 'chevron-right'} size={16} color={theme.textTertiary} strokeWidth={2} />
            </View>
          </Pressable>
          {showSections ? (
            <View style={styles.subList}>
              <SubOption
                label={t('detail.noSection')}
                active={task.section_id == null}
                onPress={() => {
                  // No project_id - task_move keeps the current project.
                  moveTask(task.id, { section_id: null });
                  setShowSections(false);
                }}
                theme={theme}
              />
              {sections.map((s) => (
                <SubOption
                  key={s.id}
                  label={s.name}
                  active={task.section_id === s.id}
                  onPress={() => {
                    moveTask(task.id, { section_id: s.id });
                    setShowSections(false);
                  }}
                  theme={theme}
                />
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      {/* Assignee — only in shared workspaces (contract §4) */}
      {multiMember ? (
        <>
          <Pressable style={[styles.row, { borderBottomColor: theme.border }]} onPress={() => setShowAssignee((s) => !s)}>
            <Icon name="user" size={20} color={theme.textTertiary} strokeWidth={2} />
            <Text style={[styles.label, { color: theme.textSecondary }]}>{t('detail.assignee')}</Text>
            <View style={styles.value}>
              {assignee ? (
                <View style={[styles.assigneeChip, { backgroundColor: theme.accentWash, borderColor: theme.accent }]}>
                  <Text style={[styles.assigneeChipText, { color: theme.accent }]}>{initials(assignee.name)}</Text>
                </View>
              ) : null}
              <Text style={[styles.valueText, { color: assignee ? theme.textPrimary : theme.textTertiary }]}>
                {assignee ? assignee.name : t('detail.unassigned')}
              </Text>
              <Icon name={showAssignee ? 'chevron-down' : 'chevron-right'} size={16} color={theme.textTertiary} strokeWidth={2} />
            </View>
          </Pressable>
          {showAssignee ? (
            <View style={styles.subList}>
              <SubOption
                label={t('detail.unassigned')}
                active={task.assigned_to == null}
                onPress={() => {
                  updateTask(task.id, { assigned_to: null });
                  setShowAssignee(false);
                }}
                theme={theme}
              />
              {members.map((m) => (
                <SubOption
                  key={m.id}
                  label={user && m.id === user.id ? t('detail.assigneeMe').replace('{name}', m.name) : m.name}
                  active={task.assigned_to === m.id}
                  onPress={() => {
                    updateTask(task.id, { assigned_to: m.id });
                    setShowAssignee(false);
                  }}
                  theme={theme}
                />
              ))}
            </View>
          ) : null}
        </>
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

      </View>
      {/* Notes */}
      <TextInput
        value={notes}
        editable={writable}
        onChangeText={setNotes}
        onBlur={commitNotes}
        placeholder={t('detail.notesPlaceholder')}
        placeholderTextColor={theme.textTertiary}
        style={[styles.notes, { color: theme.textPrimary }]}
        multiline
      />

      {/* Comments */}
      <CommentsSection
        task={task}
        snap={snap}
        userId={user?.id ?? null}
        role={myRole}
        onComposerFocus={scrollToComposer}
      />

      {/* Delete — hidden for read-only viewers */}
      {writable && (
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
      )}
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

function CommentsSection({
  task,
  snap,
  userId,
  role,
  onComposerFocus,
}: {
  task: Task;
  snap: ReturnType<typeof useSnapshot>;
  userId: string | null;
  role: Role | undefined;
  onComposerFocus?: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useT();
  const [draft, setDraft] = useState('');
  const comments = commentsForTask(snap, task.id);
  const writable = canComment(role);
  const now = Date.now();

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    addComment(task.id, body);
    setDraft(''); // sheet stays open (contract §5.4: composer keeps context)
  };

  return (
    <View style={[styles.comments, { borderTopColor: theme.border }]}>
      <View style={styles.commentsHeader}>
        <Icon name="message-square" size={18} color={theme.textTertiary} strokeWidth={2} />
        <Text style={[styles.commentsTitle, { color: theme.textSecondary }]}>{t('comment.section')}</Text>
        {comments.length > 0 ? (
          <Text style={[styles.commentsCount, { color: theme.textTertiary }]}>{comments.length}</Text>
        ) : null}
      </View>

      {comments.length === 0 ? (
        <Text style={[styles.commentsEmpty, { color: theme.textTertiary }]}>{t('comment.empty')}</Text>
      ) : (
        comments.map((c) => (
          <CommentItem
            key={c.id}
            comment={c}
            authorName={snap.members.find((m) => m.id === c.author_id)?.name ?? '?'}
            canEdit={canEditComment(c, userId)}
            canDelete={canDeleteComment(c, userId, role)}
            now={now}
            locale={locale}
            t={t}
            theme={theme}
          />
        ))
      )}

      {writable ? (
        <View style={[styles.composer, { borderColor: theme.border }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onFocus={onComposerFocus}
            placeholder={t('comment.placeholder')}
            placeholderTextColor={theme.textTertiary}
            style={[styles.composerInput, { color: theme.textPrimary }]}
            multiline
          />
          <Pressable
            onPress={submit}
            disabled={draft.trim().length === 0}
            hitSlop={8}
            accessibilityLabel={t('comment.send')}
            style={[
              styles.sendBtn,
              { backgroundColor: draft.trim() ? theme.accent : theme.border },
            ]}
          >
            <Icon name="send" size={16} color={draft.trim() ? theme.onAccent : theme.textTertiary} strokeWidth={2} />
          </Pressable>
        </View>
      ) : (
        <Text style={[styles.commentsEmpty, { color: theme.textTertiary }]}>{t('comment.readOnly')}</Text>
      )}
    </View>
  );
}

function CommentItem({
  comment,
  authorName,
  canEdit,
  canDelete,
  now,
  locale,
  t,
  theme,
}: {
  comment: Comment;
  authorName: string;
  canEdit: boolean;
  canDelete: boolean;
  now: number;
  locale: ReturnType<typeof useT>['locale'];
  t: ReturnType<typeof useT>['t'];
  theme: ReturnType<typeof useTheme>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.body);
  const edited = comment.updated_at > comment.created_at;

  const save = () => {
    const body = text.trim();
    if (body && body !== comment.body) updateComment(comment.id, body);
    setEditing(false);
  };

  return (
    <View style={[styles.comment, { borderBottomColor: theme.border }]}>
      <View style={[styles.commentAvatar, { backgroundColor: theme.accentWash, borderColor: theme.accent }]}>
        <Text style={[styles.commentAvatarText, { color: theme.accent }]}>{initials(authorName)}</Text>
      </View>
      <View style={styles.commentBody}>
        <View style={styles.commentMeta}>
          <Text style={[styles.commentAuthor, { color: theme.textPrimary }]} numberOfLines={1}>
            {authorName}
          </Text>
          <Text style={[styles.commentTime, { color: theme.textTertiary }]}>
            {relativeTime(comment.created_at, now, locale, t)}
            {edited ? ` · ${t('comment.edited')}` : ''}
          </Text>
        </View>
        {editing ? (
          <>
            <TextInput
              value={text}
              onChangeText={setText}
              autoFocus
              multiline
              style={[styles.commentEditInput, { color: theme.textPrimary, borderColor: theme.border }]}
            />
            <View style={styles.commentActions}>
              <Pressable onPress={() => { setText(comment.body); setEditing(false); }} hitSlop={6}>
                <Text style={[styles.commentAction, { color: theme.textTertiary }]}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable onPress={save} hitSlop={6}>
                <Text style={[styles.commentAction, { color: theme.accent }]}>{t('comment.save')}</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.commentText, { color: theme.textPrimary }]}>{comment.body}</Text>
            {canEdit || canDelete ? (
              <View style={styles.commentActions}>
                {canEdit ? (
                  <Pressable onPress={() => { setText(comment.body); setEditing(true); }} hitSlop={6} style={styles.commentActionBtn}>
                    <Icon name="pencil" size={13} color={theme.textTertiary} strokeWidth={2} />
                    <Text style={[styles.commentAction, { color: theme.textTertiary }]}>{t('comment.edit')}</Text>
                  </Pressable>
                ) : null}
                {canDelete ? (
                  <Pressable onPress={() => deleteComment(comment.id)} hitSlop={6} style={styles.commentActionBtn}>
                    <Icon name="trash-2" size={13} color={theme.danger} strokeWidth={2} />
                    <Text style={[styles.commentAction, { color: theme.danger }]}>{t('comment.delete')}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </View>
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
  assigneeChip: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 4,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assigneeChipText: { fontSize: 11, fontWeight: font.weightSemibold },
  // ── Comments ──
  comments: { paddingTop: space.s5, borderTopWidth: StyleSheet.hairlineWidth, marginTop: space.s4 },
  commentsHeader: { flexDirection: 'row', alignItems: 'center', gap: space.s2, paddingBottom: space.s3 },
  commentsTitle: { fontSize: font.secondary, fontWeight: font.weightSemibold },
  commentsCount: { fontSize: font.caption, fontVariant: ['tabular-nums'] },
  commentsEmpty: { fontSize: font.secondary, paddingVertical: space.s2 },
  comment: { flexDirection: 'row', gap: space.s3, paddingVertical: space.s3, borderBottomWidth: StyleSheet.hairlineWidth },
  commentAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentAvatarText: { fontSize: 12, fontWeight: font.weightSemibold },
  commentBody: { flex: 1, gap: 3 },
  commentMeta: { flexDirection: 'row', alignItems: 'baseline', gap: space.s2 },
  commentAuthor: { fontSize: font.secondary, fontWeight: font.weightMedium, flexShrink: 1 },
  commentTime: { fontSize: font.caption },
  commentText: { fontSize: font.secondary, lineHeight: font.secondary * 1.4 },
  commentEditInput: {
    fontSize: font.secondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingHorizontal: space.s3,
    paddingVertical: space.s2,
    minHeight: 44,
  },
  commentActions: { flexDirection: 'row', gap: space.s4, paddingTop: 2 },
  commentActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  commentAction: { fontSize: font.caption, fontWeight: font.weightMedium },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.s2,
    marginTop: space.s3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.control,
    paddingLeft: space.s3,
    paddingRight: space.s2,
    paddingVertical: space.s2,
  },
  composerInput: { flex: 1, fontSize: font.secondary, maxHeight: 120, paddingTop: 4, paddingBottom: 4 },
  sendBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
