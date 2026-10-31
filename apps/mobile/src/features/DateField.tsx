import { todayLocalISO, type IsoDate } from '@balu/domain';
import { parseQuickAdd } from '@balu/nl-parser';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { relativeDate } from '../lib/format';
import { useT } from '../i18n';
import { useTheme } from '../theme/ThemeProvider';
import { font, radius, space } from '../theme/tokens';
import { Icon, type IconName } from '../components/Icon';

function isoToDate(iso: IsoDate | null): Date {
  if (!iso) return new Date();
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
function dateToIso(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface DateFieldProps {
  icon: IconName;
  label: string;
  value: IsoDate | null;
  onChange: (value: IsoDate | null) => void;
  /** Read-only viewer: every control disabled for touch and assistive tech. */
  disabled?: boolean;
}

/** A detail-sheet row: NL text entry ("tomorrow", "next tue") + native picker. */
export function DateField({ icon, label, value, onChange, disabled = false }: DateFieldProps) {
  const theme = useTheme();
  const { t, locale } = useT();
  // Seed captured once on open: `isoToDate(null)` is a fresh `new Date()` each render.
  const [pickerSeed, setPickerSeed] = useState<Date | null>(null);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);

  const rel = value ? relativeDate(value, todayLocalISO(), locale, t) : null;
  const valueColor = rel?.tone === 'overdue' ? theme.danger : rel?.tone === 'today' ? theme.accent : theme.textPrimary;

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
    if (iso) onChange(iso);
    setText('');
    setEditing(false);
  };

  // Stable identity: the Android wrapper re-opens the dialog whenever `onChange` or
  // `value` changes, so both must stay stable while the dialog is open.
  const latestOnChange = useRef(onChange);
  latestOnChange.current = onChange;
  const onPickerChange = useCallback((e: DateTimePickerEvent, d?: Date) => {
    setPickerSeed(null);
    if (e.type === 'set' && d) latestOnChange.current(dateToIso(d));
  }, []);

  // A role drop to viewer mid-edit must not leave a stale picker or input behind.
  useEffect(() => {
    if (disabled) {
      setPickerSeed(null);
      setEditing(false);
    }
  }, [disabled]);

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <Icon name={icon} size={20} color={theme.textTertiary} strokeWidth={2} />
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
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
            accessibilityLabel={`${label}, ${rel ? rel.text : t('detail.none')}`}
            accessibilityState={{ disabled }}
          >
            <Text style={[styles.value, { color: rel ? valueColor : theme.textTertiary }]}>
              {rel ? rel.text : t('detail.none')}
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => setPickerSeed(isoToDate(value))}
          hitSlop={8}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${t('detail.pickDate')}`}
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
            accessibilityLabel={`${label}, ${t('detail.clear')}`}
            accessibilityState={{ disabled }}
          >
            <Icon name="x" size={16} color={theme.textTertiary} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>
      {pickerSeed && !disabled ? (
        <DateTimePicker value={pickerSeed} mode="date" display="default" onChange={onPickerChange} />
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
