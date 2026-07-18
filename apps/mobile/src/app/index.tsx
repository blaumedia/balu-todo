import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useApp } from '../store/app';
import { useTheme } from '../theme/ThemeProvider';

/** Cold-start gate: route to onboarding or the app once boot resolves. */
export default function Index() {
  const boot = useApp((s) => s.boot);
  const theme = useTheme();

  if (boot === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (boot === 'onboarding') return <Redirect href="/onboarding" />;
  return <Redirect href="/today" />;
}
