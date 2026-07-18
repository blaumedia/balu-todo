import { todayLocalISO, type IsoDate } from '@balu/domain';
import { parseQuickAdd } from '@balu/nl-parser';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
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
}

/** A detail-sheet row: NL text entry ("tomorrow", "next tue") + native picker. */
export function DateField({ icon, label, value, onChange }: DateFieldProps) {
  const theme = useTheme();
  const { t, locale } = useT();
  const [showPicker, setShowPicker] = useState(false);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);

  const rel = value ? relativeDate(value, todayLocalISO(), locale, t) : null;
  const valueColor = rel?.tone === 'overdue' ? theme.danger : rel?.tone === 'today' ? theme.accent : theme.textPrimary;

  const submitText = () => {
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

  const onPickerChange = (e: DateTimePickerEvent, d?: Date) => {
    setShowPicker(false);
    if (e.type === 'set' && d) onChange(dateToIso(d));
  };

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
          />
        ) : (
          <Pressable onPress={() => setEditing(true)}>
            <Text style={[styles.value, { color: rel ? valueColor : theme.textTertiary }]}>
              {rel ? rel.text : t('detail.none')}
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
        <DateTimePicker value={isoToDate(value)} mode="date" display="default" onChange={onPickerChange} />
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
