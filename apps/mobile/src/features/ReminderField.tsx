import { todayLocalISO, type IsoDate, type IsoDateTime } from '@balu/domain';
import { parseQuickAdd } from '@balu/nl-parser';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../components/Icon';
import { relativeDate } from '../lib/format';
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
function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
}

/**
 * Task-detail row for `reminder_at`: a natural-language date entry (defaults to
 * 09:00 on the parsed day) plus a native date+time picker for precision.
 * Writes a UTC ISO datetime, matching the contract's `reminder_at`.
 */
export function ReminderField({ value, onChange }: ReminderFieldProps) {
  const theme = useTheme();
  const { t, locale } = useT();
  const [showPicker, setShowPicker] = useState(false);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);

  const current = value ? new Date(value) : null;
  const rel = current ? relativeDate(localISODate(current), todayLocalISO(), locale, t) : null;
  const overdue = current != null && current.getTime() <= Date.now();
  const valueColor = overdue ? theme.danger : rel?.tone === 'today' ? theme.accent : theme.textPrimary;

  const submitText = () => {
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

  const onPickerChange = (e: DateTimePickerEvent, d?: Date) => {
    setShowPicker(false);
    if (e.type === 'set' && d) onChange(d.toISOString());
  };

  return (
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
          />
        ) : (
          <Pressable onPress={() => setEditing(true)}>
            <Text style={[styles.value, { color: rel ? valueColor : theme.textTertiary }]}>
              {rel && current ? `${rel.text} · ${hhmm(current)}` : t('detail.none')}
            </Text>
          </Pressable>
        )}
        <Pressable onPress={() => setShowPicker(true)} hitSlop={8}>
          <Icon name="calendar-days" size={18} color={theme.accent} strokeWidth={2} />
        </Pressable>
        {value ? (
          <Pressable onPress={() => onChange(null)} hitSlop={8}>
            <Icon name="x" size={16} color={theme.textTertiary} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>
      {showPicker ? (
        <DateTimePicker value={current ?? atTime(todayLocalISO(), 9, 0)} mode="datetime" display="default" onChange={onPickerChange} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s3, paddingVertical: space.s3, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: font.secondary, flexShrink: 0 },
  right: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: space.s3, flexShrink: 1 },
  value: { fontSize: font.secondary, fontVariant: ['tabular-nums'] },
  input: { minWidth: 130, fontSize: font.secondary, borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: 8, paddingVertical: 4 },
});
