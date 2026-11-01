import { useNavigation } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { canDismissState, gateTarget, leaveGate } from '../lib/goBack';
import { useApp } from '../store/app';
import { useTheme } from '../theme/ThemeProvider';

/** Cold-start gate: route to onboarding or the app once boot resolves. */
export default function Index() {
  const boot = useApp((s) => s.boot);
  const theme = useTheme();
  const navigation = useNavigation();

  // With the root anchor the stack at "/" is [(tabs), index]: a plain Redirect would
  // leave (tabs) below onboarding (Back = a tab with no session) or a second (tabs)
  // above the first. leaveGate clears the stack first.
  useEffect(() => {
    const target = gateTarget(boot);
    if (target) leaveGate(target, canDismissState(navigation.getState()));
  }, [boot, navigation]);

  // reconnecting / noWorkspace: components/BootNotice explains; the gate just waits.
  if (boot === 'loading' || boot === 'reconnecting' || boot === 'noWorkspace') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
}
