import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

/** Small completion ring for a project header (DESIGN screen inventory §7.3). */
export function ProgressRing({ done, total, size = 28, stroke = 3 }: { done: number; total: number; size?: number; stroke?: number }) {
  const theme = useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = total > 0 ? done / total : 0;
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.border} strokeWidth={stroke} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={theme.accent}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${c * ratio} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}
