// Live token highlighting for quick-add (DESIGN §2): dates/recurrence → accent,
// #project → violet, @label → amber, !priority → its priority color.
import { StyleSheet, Text, View } from 'react-native';
import type { TokenType } from '@balu/nl-parser';
import { useTheme } from '../theme/ThemeProvider';
import { font, radius } from '../theme/tokens';

export function tokenColor(type: TokenType, priority: number, theme: ReturnType<typeof useTheme>): string {
  switch (type) {
    case 'project':
      return theme.tokenProject;
    case 'label':
      return theme.tokenLabel;
    case 'priority':
      return priority === 1 ? theme.priority1 : priority === 2 ? theme.priority2 : theme.priority3;
    default:
      return theme.tokenDate; // start / deadline / evening / recurrence
  }
}

/** A single tinted pill shown under the quick-add input. */
export function TokenPill({ type, label, priority = 0 }: { type: TokenType; label: string; priority?: number }) {
  const theme = useTheme();
  const color = tokenColor(type, priority, theme);
  return (
    <View style={[styles.pill, { backgroundColor: color + '22', borderColor: color + '55' }]}>
      <Text style={[styles.text, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  text: {
    fontSize: font.caption,
    fontWeight: font.weightMedium,
  },
});
