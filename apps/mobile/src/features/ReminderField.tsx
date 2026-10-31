import { todayLocalISO, type IsoDate, type IsoDateTime } from '@balu/domain';
import { parseQuickAdd } from '@balu/nl-parser';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../components/Icon';
import { relativeDate } from '../lib/format';
import { combineDayAndTime, firstReminderPickerStep, formatReminderTime, reminderDialogStep, uses24h, type PickedDay, type ReminderPickerStep } from '../lib/reminderPicker';
import { useT } from '../i18n';
import { useTheme } from '../theme/ThemeProvider';
import { font, radius, space } from '../theme/tokens';

/** Local calendar date (YYYY-MM-DD) of a datetime, in the device timezone. */
function localISODate(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
/** Build a local Date from an IsoDate at a given hour:minute. */
function atTime(iso: IsoDate, hour: number, minute: number): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0);
}

export interface ReminderFieldProps {
  /** UTC ISO datetime (`reminder_at`) or null. */
  value: IsoDateTime | null;
  onChange: (value: IsoDateTime | null) => void;
  /** Read-only viewer: every control disabled for touch and assistive tech. */
  disabled?: boolean;
}

/**
 * Task-detail row for `reminder_at`: a natural-language date entry (defaults to
 * 09:00 on the parsed day) plus a native date+time picker for precision.
 * Writes a UTC ISO datetime, matching the contract's `reminder_at`.
 */
export function ReminderField({ value, onChange, disabled = false }: ReminderFieldProps) {
  const theme = useTheme();
  const { t, locale } = useT();
  const [step, setStep] = useState<ReminderPickerStep | null>(null);
  const [day, setDay] = useState<PickedDay | null>(null); // Android: the date from step 1
  const [draft, setDraft] = useState<Date | null>(null); // iOS: the wheel value until Done
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);

  const current = value ? new Date(value) : null;
  const rel = current ? relativeDate(localISODate(current), todayLocalISO(), locale, t) : null;
  const overdue = current != null && current.getTime() <= Date.now();
  const valueColor = overdue ? theme.danger : rel?.tone === 'today' ? theme.accent : theme.textPrimary;

  const display = rel && current ? `${rel.text} · ${formatReminderTime(current, locale)}` : t('detail.none');

  const submitText = () => {
    if (disabled) {
      setText('');
      setEditing(false);
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      setEditing(false);
      return;
    }
    const parsed = parseQuickAdd(trimmed, { locale, referenceDate: todayLocalISO() });
    const iso = parsed.startDate ?? parsed.deadline;
    if (iso) onChange(atTime(iso, 9, 0).toISOString());
    setText('');
    setEditing(false);
  };

  // Only read when the picker opens (openPicker freezes it into `draft`).
  const seed = current ?? atTime(todayLocalISO(), 9, 0);

  const closePicker = () => {
    setStep(null);
    setDay(null);
    setDraft(null);
  };
  const openPicker = () => {
    setDay(null);
    setDraft(seed);
    setStep(firstReminderPickerStep(Platform.OS));
  };

  // Android dialogs: date, then time; commit only after the time dialog's OK.
  // The handler must keep a stable identity: the Android wrapper re-opens the
  // dialog whenever `onChange` changes, which would reset the dial mid-selection.
  const dialogState = useRef({ step, day, onChange });
  dialogState.current = { step, day, onChange };
  const onDialogChange = useCallback((e: DateTimePickerEvent, d?: Date) => {
    const cur = dialogState.current;
    if (!cur.step) return;
    const r = reminderDialogStep(cur.step, cur.day, e.type, d);
    setDay(r.day);
    setStep(r.next);
    if (r.commit) cur.onChange(r.commit.toISOString());
  }, []);

  // A role drop to viewer mid-edit must not leave a stale picker or input behind.
  useEffect(() => {
    if (disabled) {
      setStep(null);
      setDay(null);
      setDraft(null);
      setEditing(false);
    }
  }, [disabled]);

  // iOS wheels report every change; keep the value until Done.
  const onWheelChange = (_e: DateTimePickerEvent, d?: Date) => {
    if (d) setDraft(d);
  };
  const commitDraft = () => {
    if (draft) onChange(draft.toISOString());
    closePicker();
  };

  return (
    <View>
      <View style={[styles.row, { borderBottomColor: theme.border }]}>
        <Icon name="bell" size={20} color={theme.textTertiary} strokeWidth={2} />
        <Text style={[styles.label, { color: theme.textSecondary }]}>{t('detail.reminder')}</Text>
        <View style={styles.right}>
          {editing ? (
            <TextInput
              autoFocus
              value={text}
              onChangeText={setText}
              onSubmitEditing={submitText}
              onBlur={submitText}
              placeholder={t('detail.datePlaceholder')}
              placeholderTextColor={theme.textTertiary}
              style={[styles.input, { color: theme.textPrimary, borderColor: theme.border }]}
              returnKeyType="done"
              editable={!disabled}
            />
          ) : (
            <Pressable
              onPress={() => setEditing(true)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`${t('detail.reminder')}, ${display}`}
              accessibilityState={{ disabled }}
            >
              <Text style={[styles.value, { color: rel ? valueColor : theme.textTertiary }]}>
                {display}
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => (step ? closePicker() : openPicker())}
            hitSlop={8}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${t('detail.reminder')}, ${t('detail.pickDate')}`}
            accessibilityState={{ disabled }}
          >
            <Icon name="calendar-days" size={18} color={theme.accent} strokeWidth={2} />
          </Pressable>
          {value ? (
            <Pressable
              onPress={() => onChange(null)}
              hitSlop={8}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`${t('detail.reminder')}, ${t('detail.clear')}`}
              accessibilityState={{ disabled }}
            >
              <Icon name="x" size={16} color={theme.textTertiary} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {step === 'datetime' && draft && !disabled ? (
        <View style={[styles.wheel, { borderBottomColor: theme.border }]}>
          <DateTimePicker value={draft} mode="datetime" display="spinner" locale={locale} onChange={onWheelChange} />
          <Pressable onPress={commitDraft} hitSlop={8} accessibilityRole="button" style={styles.done}>
            <Text style={[styles.doneText, { color: theme.accent }]}>{t('common.done')}</Text>
          </Pressable>
        </View>
      ) : null}
      {(step === 'date' || step === 'time') && draft && !disabled ? (
        <DateTimePicker
          key={step}
          // Frozen: a remote change or midnight must not reset an open dialog.
          value={step === 'time' && day ? combineDayAndTime(day, draft) : draft}
          mode={step}
          display="default"
          is24Hour={uses24h(locale)}
          onChange={onDialogChange}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingVertical: space.s3, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: font.secondary, flexShrink: 0 },
  right: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: space.s3, flexShrink: 1 },
  value: { fontSize: font.secondary, fontVariant: ['tabular-nums'] },
  wheel: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: space.s2 },
  done: { alignSelf: 'flex-end', paddingVertical: space.s2, paddingHorizontal: space.s2 },
  doneText: { fontSize: font.secondary, fontWeight: font.weightSemibold },
  input: { minWidth: 130, fontSize: font.secondary, borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: 8, paddingVertical: 4 },
});
