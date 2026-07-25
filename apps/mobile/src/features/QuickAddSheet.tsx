import { todayLocalISO } from '@balu/domain';
import { parseQuickAdd } from '@balu/nl-parser';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '../components/BottomSheet';
import { Icon } from '../components/Icon';
import { TokenPill } from '../components/TokenPill';
import { addTask } from '../lib/actions';
import { interpretChange } from '../lib/quickAddInput';
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
  const [inputEpoch, setInputEpoch] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const lastSubmitAt = useRef(0);
  const today = todayLocalISO();

  // Refocus + clear each time the sheet opens (capture is sacred, DESIGN §1).
  useEffect(() => {
    if (open) {
      setText('');
      // A backdrop-dismiss mid-composition can leave the IME holding stale
      // text that a reopened composer would silently submit — remount too.
      if (Platform.OS === 'android') setInputEpoch((e) => e + 1);
      const timer = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const parsed = useMemo(
    () => (text.trim() ? parseQuickAdd(text, { locale, referenceDate: today }) : null),
    [text, locale, today],
  );

  const submit = (raw?: string) => {
    // `raw` lets a caller submit text that state hasn't caught up with yet —
    // the hardware-Return path below has the value before `setText` lands.
    const trimmed = (raw ?? text).trim();
    if (!trimmed) return;
    // A hardware enter (BT keyboard, adb) fires onSubmitEditing twice on
    // Android — once via the key event, once via the editor action. Whether
    // the second call still sees the old text is a render race, so debounce.
    const now = Date.now();
    if (now - lastSubmitAt.current < 400) return;
    lastSubmitAt.current = now;
    const result = parseQuickAdd(trimmed, { locale, referenceDate: today });
    const args = composeTaskArgs(trimmed, result, {
      context,
      projects: snap.projects,
      labels: snap.labels,
      today,
    });
    addTask(args);
    setText(''); // submit-and-add-another: stay open, keep focus
    inputRef.current?.clear();
    // Gboard's composing region survives a controlled clear and resurrects
    // the stale text into the next submission — remount to reset the IME,
    // then refocus so submit-and-add-another keeps the keyboard up.
    if (Platform.OS === 'android') {
      setInputEpoch((e) => e + 1);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  };

  return (
    <BottomSheet visible={open} onClose={close}>
      <View style={styles.inputRow}>
        {/* Tappable, not decorative: when the return key does not submit (a
            hardware keyboard on iOS did exactly that), this is the only way to
            add a task, and the sheet's hint says "Return to add". */}
        <Pressable
          onPress={() => submit()}
          disabled={!text.trim()}
          accessibilityRole="button"
          accessibilityLabel={t('quickadd.add')}
          style={[styles.plus, { backgroundColor: theme.accentWash, opacity: text.trim() ? 1 : 0.5 }]}
        >
          <Icon name="plus" size={18} color={theme.accent} strokeWidth={2.5} />
        </Pressable>
        <TextInput
          key={inputEpoch}
          ref={inputRef}
          autoFocus={open}
          value={text}
          onChangeText={(v) => {
            // A hardware Return arrives here as a newline, not as an editor
            // action — see `interpretChange`.
            const intent = interpretChange(v);
            // Always sync state, including on the submit path: if the debounce
            // rejects the submit, neither branch ran and the native field kept
            // the newline while state did not — the next keystroke could then
            // resubmit the leftover text.
            setText(intent.text);
            if (intent.submit) submit(intent.submit);
          }}
          onSubmitEditing={() => submit()}
          // On the new architecture, blurOnSubmit is ignored for multiline
          // inputs — submitBehavior is what makes the return key submit
          // (and keep focus) instead of inserting a newline.
          submitBehavior="submit"
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
