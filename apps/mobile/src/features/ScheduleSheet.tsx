import { addDaysISO, dowISO, todayLocalISO, type IsoDate } from '@balu/domain';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { Icon, type IconName } from '../components/Icon';
import { Title } from '../components/Title';
import { scheduleTask } from '../lib/actions';
import { useT, type TranslationKey } from '../i18n';
import { useApp } from '../store/app';
import { useTheme } from '../theme/ThemeProvider';
import { font, hit, space } from '../theme/tokens';

function dateToIso(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function ScheduleSheet() {
  const theme = useTheme();
  const { t } = useT();
  const taskId = useApp((s) => s.scheduleTaskId);
  const close = useApp((s) => s.closeSchedule);
  const [showPicker, setShowPicker] = useState(false);

  const today = todayLocalISO();
  const dow = dowISO(today); // 0 Sun … 6 Sat
  const daysToSat = (6 - dow + 7) % 7;
  const weekend = addDaysISO(today, daysToSat);
  const daysToMon = ((1 - dow + 7) % 7) || 7;
  const nextWeek = addDaysISO(today, daysToMon);

  const apply = (fn: () => void) => {
    fn();
    close();
  };

  const options: { key: TranslationKey; icon: IconName; run: () => void; tint?: string }[] = [
    { key: 'schedule.today', icon: 'star', run: () => taskId && scheduleTask(taskId, { start_date: today, evening: false }), tint: theme.accent },
    { key: 'schedule.evening', icon: 'sunset', run: () => taskId && scheduleTask(taskId, { start_date: today, evening: true }) },
    { key: 'schedule.tomorrow', icon: 'calendar', run: () => taskId && scheduleTask(taskId, { start_date: addDaysISO(today, 1), evening: false }) },
    { key: 'schedule.weekend', icon: 'calendar-days', run: () => taskId && scheduleTask(taskId, { start_date: weekend, evening: false }) },
    { key: 'schedule.nextWeek', icon: 'calendar-days', run: () => taskId && scheduleTask(taskId, { start_date: nextWeek, evening: false }) },
    { key: 'schedule.someday', icon: 'archive', run: () => taskId && scheduleTask(taskId, { someday: true }) },
  ];

  const onPickerChange = (e: DateTimePickerEvent, d?: Date) => {
    setShowPicker(false);
    if (e.type === 'set' && d && taskId) {
      scheduleTask(taskId, { start_date: dateToIso(d), evening: false });
      close();
    }
  };

  return (
    <BottomSheet visible={taskId != null} onClose={close}>
      <Title>{t('schedule.title')}</Title>
      <View style={styles.list}>
        {options.map((o) => (
          <Pressable
            key={o.key}
            onPress={() => apply(o.run)}
            style={({ pressed }) => [styles.opt, pressed && { backgroundColor: theme.accentWash }]}
          >
            <Icon name={o.icon} size={20} color={o.tint ?? theme.textSecondary} strokeWidth={2} />
            <Text style={[styles.optLabel, { color: theme.textPrimary }]}>{t(o.key)}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setShowPicker(true)}
          style={({ pressed }) => [styles.opt, pressed && { backgroundColor: theme.accentWash }]}
        >
          <Icon name="calendar-days" size={20} color={theme.textSecondary} strokeWidth={2} />
          <Text style={[styles.optLabel, { color: theme.textPrimary }]}>{t('schedule.pickDate')}</Text>
        </Pressable>
        <Pressable
          onPress={() => apply(() => taskId && scheduleTask(taskId, { start_date: null, evening: false }))}
          style={({ pressed }) => [styles.opt, pressed && { backgroundColor: theme.accentWash }]}
        >
          <Icon name="x" size={20} color={theme.textTertiary} strokeWidth={2} />
          <Text style={[styles.optLabel, { color: theme.textSecondary }]}>{t('schedule.clear')}</Text>
        </Pressable>
      </View>
      {showPicker ? (
        <DateTimePicker value={new Date()} mode="date" display="default" onChange={onPickerChange} />
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { paddingTop: space.s2 },
  opt: { minHeight: hit, flexDirection: 'row', alignItems: 'center', gap: space.s4, paddingVertical: space.s3, paddingHorizontal: space.s1, borderRadius: 8 },
  optLabel: { fontSize: font.body },
});
