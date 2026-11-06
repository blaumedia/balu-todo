import { selectList, todayLocalISO } from '@balu/domain';
import { Tabs, useTheme as useNavTheme } from 'expo-router';
// Label is deprecated in expo-router's react-navigation re-exports ("copy it into your codebase");
// when a later SDK removes it, replace it with a local Text using the same numberOfLines, centring and tint.
import { Label } from 'expo-router/react-navigation';
import { useWindowDimensions, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Fab } from '../../components/Fab';
import { Icon, type IconName } from '../../components/Icon';
import { NavRailContext, useNavRailExtent } from '../../hooks/use-layout';
import { useMyRole } from '../../hooks/use-my-role';
import { useT } from '../../i18n';
import { bottomBarHeight, FAB_EDGE_GAP, fabBottomBarOffset } from '../../lib/layout';
import { canQuickAddFromTabs } from '../../lib/role';
import { useApp } from '../../store/app';
import { useSnapshot } from '../../store/useSnapshot';
import { useTheme } from '../../theme/ThemeProvider';
import { font, space } from '../../theme/tokens';

export const unstable_settings = { anchor: 'today' };

// The one label style: tabBarLabelStyle (bottom bar) and the rail label below.
const tabLabelStyle = { fontSize: 11, fontWeight: font.weightMedium };

// Android and web: the JS tabs. Bottom bar on phones exactly as before; from RAIL_MIN_WINDOW_WIDTH a navigation rail on the left, switched live when the window changes (rotation, unfold, multi-window). iOS uses _layout.ios.tsx (NativeTabs).
export default function TabsLayout() {
  const theme = useTheme();
  const { fonts } = useNavTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const openQuickAdd = useApp((s) => s.openQuickAdd);
  const role = useMyRole();
  const railExtent = useNavRailExtent();
  const rail = railExtent > 0;
  const snap = useSnapshot();
  const inboxCount = selectList(snap.tasks, snap.projects, 'inbox', todayLocalISO()).length;

  const icon = (name: IconName) =>
    function TabIcon({ color, size }: { color: ColorValue; size: number }) {
      return <Icon name={name} size={size} color={color as string} strokeWidth={2} />;
    };

  // Rail only: the navigator's own label (same component and theme font as the bottom bar), minus its one-line limit.
  // Above the 176 dp cap of the rail a long label may break across two lines instead of ellipsizing (untested in practice).
  // The navigator ignores tabBarLabelStyle for a function label, so tabLabelStyle is applied here.
  const railLabel = ({ color, children }: { color: ColorValue; children: string }) => (
    <Label tintColor={color} numberOfLines={2} style={[fonts.medium, tabLabelStyle]}>
      {children}
    </Label>
  );

  // Bottom bar above font scale 1 only: the label scales with the font but its item is a quarter of the width, so a long
  // label ("Demnächst") would end in an ellipsis; shrink it to fit instead. Same component and style as the default label.
  const bottomLabel = ({ color, children }: { color: ColorValue; children: string }) => (
    <Label tintColor={color} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} style={[fonts.medium, tabLabelStyle]}>
      {children}
    </Label>
  );

  return (
    <View style={{ flex: 1 }}>
      <NavRailContext.Provider value={railExtent}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: theme.accent,
            tabBarInactiveTintColor: theme.textTertiary,
            tabBarLabelStyle: tabLabelStyle,
            // Phones: the defaults ('bottom', 'uikit'), unchanged. Rail: the navigator's own Material rail, so the
            // tab items (role, selected state, label, badge) are the same component as on the bottom bar.
            tabBarPosition: rail ? 'left' : 'bottom',
            tabBarVariant: rail ? 'material' : 'uikit',
            tabBarLabel: rail ? railLabel : fontScale > 1 ? bottomLabel : undefined,
            tabBarLabelPosition: rail ? 'below-icon' : undefined, // below-icon keeps it a narrow rail, not a wide sidebar
            tabBarActiveBackgroundColor: rail ? 'transparent' : undefined, // tinted like the phone bar; a pill would span the whole rail
            tabBarStyle: rail
              ? {
                  // The rail absorbs the left inset (cutout, left 3-button bar); items get the rail width (railWidth(fontScale)).
                  width: railExtent,
                  paddingStart: insets.left,
                  paddingEnd: 0,
                  paddingTop: insets.top + space.s3,
                  backgroundColor: theme.surface,
                  borderColor: theme.border,
                }
              : {
                  backgroundColor: theme.surface,
                  borderTopColor: theme.border,
                  // Only above font scale 1: the default height (49 + inset) stays untouched, so phones at the default scale look as before.
                  ...(fontScale > 1 ? { height: bottomBarHeight(fontScale) + insets.bottom } : null),
                },
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
      </NavRailContext.Provider>
      {/* Hidden for read-only members; kept while the role is unknown (see canQuickAddFromTabs). */}
      {canQuickAddFromTabs(role) ? (
        <Fab onPress={openQuickAdd} bottom={rail ? insets.bottom + FAB_EDGE_GAP : insets.bottom + fabBottomBarOffset(fontScale)} label={t('project.addTask')} />
      ) : null}
    </View>
  );
}
