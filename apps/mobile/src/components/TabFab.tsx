import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMyRole } from '../hooks/use-my-role';
import { useT } from '../i18n';
import { FAB_EDGE_GAP } from '../lib/layout';
import { canQuickAddFromTabs } from '../lib/role';
import { useApp } from '../store/app';
import { Fab } from './Fab';

/** The tabs' add button on iOS, rendered inside each tab screen: NativeTabs exposes no tab bar height,
 *  but the tab's own SafeAreaProvider inset already includes the tab bar.
 *  Android: the JS tabs layout renders the FAB itself (it knows the bar and the rail), so this renders nothing. */
export function TabFab() {
  const insets = useSafeAreaInsets();
  const openQuickAdd = useApp((s) => s.openQuickAdd);
  const role = useMyRole();
  const { t } = useT();
  // Hidden for read-only members; kept while the role is unknown (see canQuickAddFromTabs).
  if (Platform.OS !== 'ios' || !canQuickAddFromTabs(role)) return null;
  return <Fab onPress={openQuickAdd} bottom={insets.bottom + FAB_EDGE_GAP} label={t('project.addTask')} />;
}
