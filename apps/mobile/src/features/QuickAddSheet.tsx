import { todayLocalISO } from '@balu/domain';
import { parseQuickAdd } from '@balu/nl-parser';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { Icon } from '../components/Icon';
import { TokenPill } from '../components/TokenPill';
import { addTask } from '../lib/actions';
import { composeTaskArgs } from '../lib/quickadd';
import { useT } from '../i18n';
import { useApp } from '../store/app';
import { useSnapshot } from '../store/useSnapshot';
import { useTheme } from '../theme/ThemeProvider';
import { font, gutter, radius, space } from '../theme/tokens';

export function QuickAddSheet() {
  const theme = useTheme();
  const { t, locale } = useT();
  const open = useApp((s) => s.quickAddOpen);
  const close = useApp((s) => s.closeQuickAdd);
  const context = useApp((s) => s.context);
  const snap = useSnapshot();
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);
  const today = todayLocalISO();

  // Refocus + clear each time the sheet opens (capture is sacred, DESIGN §1).
  useEffect(() => {
    if (open) {
      setText('');
      const timer = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const parsed = useMemo(
    () => (text.trim() ? parseQuickAdd(text, { locale, referenceDate: today }) : null),
    [text, locale, today],
  );

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const result = parseQuickAdd(trimmed, { locale, referenceDate: today });
    const args = composeTaskArgs(trimmed, result, {
      context,
      projects: snap.projects,
      labels: snap.labels,
      today,
    });
    addTask(args);
    setText(''); // submit-and-add-another: stay open, keep focus
  };

  return (
    <BottomSheet visible={open} onClose={close}>
      <View style={styles.inputRow}>
        <View style={[styles.plus, { backgroundColor: theme.accentWash }]}>
          <Icon name="plus" size={18} color={theme.accent} strokeWidth={2.5} />
        </View>
        <TextInput
          ref={inputRef}
          autoFocus={open}
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          blurOnSubmit={false}
          returnKeyType="done"
          placeholder={t('quickadd.placeholder')}
          placeholderTextColor={theme.textTertiary}
          style={[styles.input, { color: theme.textPrimary }]}
          multiline
        />
      </View>

      {parsed && parsed.tokens.length > 0 ? (
        <View style={styles.pills}>
          {parsed.tokens.map((tok, i) => (
            <TokenPill
              key={`${tok.start}-${i}`}
              type={tok.type}
              label={text.slice(tok.start, tok.end)}
              priority={tok.type === 'priority' ? Number(tok.value) : 0}
            />
          ))}
        </View>
      ) : null}

      <Text style={[styles.hint, { color: theme.textTertiary }]}>{t('quickadd.hint')}</Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  inputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s3, paddingTop: space.s2 },
  plus: { width: 28, height: 28, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  input: { flex: 1, fontSize: font.title, fontWeight: font.weightMedium, minHeight: 32, paddingTop: 0, maxHeight: 160 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2, paddingTop: space.s4 },
  hint: { fontSize: font.caption, paddingTop: space.s4, paddingBottom: space.s2, paddingHorizontal: gutter - gutter },
});
