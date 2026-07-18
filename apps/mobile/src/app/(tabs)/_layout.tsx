import { todayLocalISO } from '@balu/domain';
import { selectList } from '@balu/domain';
import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Fab } from '../../components/Fab';
import { Icon, type IconName } from '../../components/Icon';
import { useT } from '../../i18n';
import { useApp } from '../../store/app';
import { useSnapshot } from '../../store/useSnapshot';
import { useTheme } from '../../theme/ThemeProvider';
import { font } from '../../theme/tokens';

export default function TabsLayout() {
  const theme = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const openQuickAdd = useApp((s) => s.openQuickAdd);
  const snap = useSnapshot();
  const inboxCount = selectList(snap.tasks, 'inbox', todayLocalISO()).length;

  const icon = (name: IconName) => ({ color, size }: { color: ColorValue; size: number }) => (
    <Icon name={name} size={size} color={color as string} strokeWidth={2} />
  );

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        initialRouteName="today"
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.accent,
          tabBarInactiveTintColor: theme.textTertiary,
          tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
          tabBarLabelStyle: { fontSize: 11, fontWeight: font.weightMedium },
        }}
      >
        <Tabs.Screen name="today" options={{ title: t('nav.today'), tabBarIcon: icon('star') }} />
        <Tabs.Screen name="upcoming" options={{ title: t('nav.upcoming'), tabBarIcon: icon('calendar') }} />
        <Tabs.Screen
          name="browse"
          options={{
            title: t('nav.browse'),
            tabBarIcon: icon('layers'),
            tabBarBadge: inboxCount > 0 ? inboxCount : undefined,
          }}
        />
        <Tabs.Screen name="search" options={{ title: t('nav.search'), tabBarIcon: icon('search') }} />
      </Tabs>
      <Fab onPress={openQuickAdd} bottom={insets.bottom + 64} />
    </View>
  );
}
