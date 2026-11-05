import { selectList, todayLocalISO } from '@balu/domain';
import { NativeTabs } from 'expo-router/native-tabs';
import { useT } from '../../i18n';
import { useSnapshot } from '../../store/useSnapshot';
import { useTheme } from '../../theme/ThemeProvider';

export const unstable_settings = { anchor: 'today' };

// iOS: system tabs (tab bar on iPhone, sidebar/rail on iPad and the Duo). The FAB lives in each tab
// screen (TabFab) because NativeTabs exposes no tab bar height. Android and web use _layout.tsx.
export default function TabsLayout() {
  const theme = useTheme();
  const { t } = useT();
  const snap = useSnapshot();
  const inboxCount = selectList(snap.tasks, snap.projects, 'inbox', todayLocalISO()).length;
  return (
    <NativeTabs
      backBehavior="initialRoute" // explicit: router warns otherwise because of the anchor; back from a tab lands on Today like the old Tabs
      preferredPlacement="automatic" // sidebar-adaptable on iPad / Duo; identical tab bar on compact iPhones
      minimizeBehavior="never" // the per-tab FAB is positioned from the bar's inset; a minimising bar would move it
      tintColor={theme.accent}
      backgroundColor={theme.surface}
      iconColor={{ default: theme.textTertiary, selected: theme.accent }}
      labelStyle={{ default: { color: theme.textTertiary }, selected: { color: theme.accent } }}
    >
      <NativeTabs.Trigger name="today">
        <NativeTabs.Trigger.Icon sf="star" />
        <NativeTabs.Trigger.Label>{t('nav.today')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="upcoming">
        <NativeTabs.Trigger.Icon sf="calendar" />
        <NativeTabs.Trigger.Label>{t('nav.upcoming')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="browse">
        <NativeTabs.Trigger.Icon sf="square.stack.3d.up" />
        <NativeTabs.Trigger.Label>{t('nav.browse')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={inboxCount === 0}>{String(inboxCount)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
        <NativeTabs.Trigger.Label>{t('nav.search')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
