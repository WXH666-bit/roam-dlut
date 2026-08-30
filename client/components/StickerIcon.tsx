import React from 'react';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

const GOLD = '#F5C26B';
const CREAM = '#F6EFDD';
const PURPLE = '#A79BFA';
const PINK = '#F2A7C8';
const BLUE = '#8FC7E8';
const GREEN = '#9FD8A3';

interface Props {
  id: string;
  size?: number;
}

/** 手绘魔法贴纸：矢量绘制，线条略带手作感 */
export function StickerIcon({ id, size = 22 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      {id === 'star' && (
        <Path
          d="M24 5 L29.5 18.5 L43.5 19.5 L33 28.5 L36.5 42.5 L24 35 L11.5 42.5 L15 28.5 L4.5 19.5 L18.5 18.5 Z"
          fill={GOLD}
        />
      )}
      {id === 'moon' && (
        <Path
          d="M31 5 C18 8 13 17 15 27 C17 37 25 43 35 42 C29 39 25 34 24 27 C22 18 25 10 31 5 Z"
          fill={CREAM}
        />
      )}
      {id === 'envelope' && (
        <>
          <Rect x={6} y={13} width={36} height={25} rx={3} stroke={CREAM} strokeWidth={2.5} fill="none" />
          <Path d="M7.5 15.5 L24 29 L40.5 15.5" stroke={CREAM} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        </>
      )}
      {id === 'cat' && (
        <>
          <Path d="M14 20 L12.5 9 L22 14.5 Z" fill={CREAM} />
          <Path d="M34 20 L35.5 9 L26 14.5 Z" fill={CREAM} />
          <Circle cx={24} cy={28} r={12} stroke={CREAM} strokeWidth={2.5} fill="none" />
          <Circle cx={19.5} cy={27} r={1.6} fill={CREAM} />
          <Circle cx={28.5} cy={27} r={1.6} fill={CREAM} />
          <Path d="M7 30 L13.5 29 M7.5 34 L13.5 32 M41 30 L34.5 29 M40.5 34 L34.5 32" stroke={CREAM} strokeWidth={1.6} strokeLinecap="round" />
        </>
      )}
      {id === 'elf' && (
        <>
          <Path d="M24 4.5 L35.5 22 L12.5 22 Z" fill={PURPLE} />
          <Circle cx={24} cy={5} r={2.6} fill={PINK} />
          <Circle cx={24} cy={32} r={10} stroke={CREAM} strokeWidth={2.5} fill="none" />
          <Circle cx={20.5} cy={31} r={1.5} fill={CREAM} />
          <Circle cx={27.5} cy={31} r={1.5} fill={CREAM} />
          <Path d="M20.5 35.5 Q24 38.5 27.5 35.5" stroke={CREAM} strokeWidth={1.8} fill="none" strokeLinecap="round" />
        </>
      )}
      {id === 'sparkle' && (
        <>
          <Path
            d="M24 4 C26.5 16 32 21.5 44 24 C32 26.5 26.5 32 24 44 C21.5 32 16 26.5 4 24 C16 21.5 21.5 16 24 4 Z"
            fill={GOLD}
          />
          <Circle cx={37.5} cy={10.5} r={2} fill={CREAM} />
        </>
      )}
      {id === 'heart' && (
        <Path
          d="M24 41 C10 30 5 21.5 10 14.5 C14 8.5 21 10 24 16 C27 10 34 8.5 38 14.5 C43 21.5 38 30 24 41 Z"
          fill={PINK}
        />
      )}
      {id === 'clover' && (
        <>
          <Circle cx={17} cy={17} r={6.5} fill={GREEN} />
          <Circle cx={31} cy={17} r={6.5} fill={GREEN} />
          <Circle cx={17} cy={31} r={6.5} fill={GREEN} />
          <Circle cx={31} cy={31} r={6.5} fill={GREEN} />
          <Path d="M24 30 Q22.5 39 17 44" stroke={GREEN} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        </>
      )}
      {id === 'candle' && (
        <>
          <Path d="M24 5 C28 11 28 14.5 24 17.5 C20 14.5 20 11 24 5 Z" fill={GOLD} />
          <Path d="M24 18.5 L24 22" stroke="#8E8BA3" strokeWidth={2} strokeLinecap="round" />
          <Rect x={19} y={22} width={10} height={20} rx={2} fill={CREAM} />
        </>
      )}
      {id === 'key' && (
        <>
          <Circle cx={16} cy={16} r={7} stroke={GOLD} strokeWidth={3} fill="none" />
          <Path d="M21 21 L36.5 36.5" stroke={GOLD} strokeWidth={3} strokeLinecap="round" />
          <Path d="M30.5 30.5 L36 25 M34.5 34.5 L40 29" stroke={GOLD} strokeWidth={3} strokeLinecap="round" />
        </>
      )}
      {id === 'coffee' && (
        <>
          <Path
            d="M10 20 L34 20 L32 38 Q31.5 41 28 41 L16 41 Q12.5 41 12 38 Z"
            stroke={CREAM} strokeWidth={2.5} fill="none" strokeLinejoin="round"
          />
          <Path d="M34 23 Q42 24 40 30 Q38 35 33 33" stroke={CREAM} strokeWidth={2.5} fill="none" strokeLinecap="round" />
          <Path d="M18 14 Q20 11 18 8 M26 14 Q28 11 26 8" stroke={CREAM} strokeWidth={2} fill="none" strokeLinecap="round" />
        </>
      )}
      {id === 'book' && (
        <>
          <Path
            d="M24 14 C19 10 12 10 7 12 L7 36 C12 34 19 34 24 38 C29 34 36 34 41 36 L41 12 C36 10 29 10 24 14 Z"
            stroke={PURPLE} strokeWidth={2.5} fill="none" strokeLinejoin="round"
          />
          <Path d="M24 14 L24 38" stroke={PURPLE} strokeWidth={2} strokeLinecap="round" />
        </>
      )}
      {id === 'cloud' && (
        <Path
          d="M14 34 A7 7 0 0 1 15 20.5 A9 9 0 0 1 32 18 A6.5 6.5 0 0 1 34.5 34 Z"
          stroke={BLUE} strokeWidth={2.5} fill="none" strokeLinejoin="round"
        />
      )}
      {id === 'music' && (
        <>
          <Ellipse cx={16.5} cy={35} rx={5} ry={4} fill={PINK} />
          <Path d="M21.5 35 L21.5 12" stroke={PINK} strokeWidth={2.5} strokeLinecap="round" />
          <Path d="M21.5 12 Q32 14 30 22 Q27 16 21.5 16 Z" fill={PINK} />
        </>
      )}
      {id === 'lantern' && (
        <>
          <Rect x={19} y={7} width={10} height={4} rx={1.5} fill={GOLD} />
          <Ellipse cx={24} cy={24} rx={11} ry={13} stroke={GOLD} strokeWidth={2.5} fill="none" />
          <Path d="M14.5 18 Q24 22.5 33.5 18 M14.5 30 Q24 25.5 33.5 30" stroke={GOLD} strokeWidth={1.5} fill="none" />
          <Rect x={19} y={36.5} width={10} height={4} rx={1.5} fill={GOLD} />
          <Path d="M24 40.5 L24 46" stroke={PINK} strokeWidth={2} strokeLinecap="round" />
        </>
      )}
      {id === 'balloon' && (
        <>
          <Ellipse cx={24} cy={17.5} rx={10} ry={12} fill={PURPLE} />
          <Path d="M24 29.5 L20.5 34 L27.5 34 Z" fill={PURPLE} />
          <Path d="M24 34 Q19.5 39.5 23.5 45" stroke={CREAM} strokeWidth={2} fill="none" strokeLinecap="round" />
        </>
      )}
      {id === 'flower' && (
        <>
          <Circle cx={24} cy={13} r={5.5} fill={PINK} />
          <Circle cx={34.5} cy={20.6} r={5.5} fill={PINK} />
          <Circle cx={30.5} cy={33.4} r={5.5} fill={PINK} />
          <Circle cx={17.5} cy={33.4} r={5.5} fill={PINK} />
          <Circle cx={13.5} cy={20.6} r={5.5} fill={PINK} />
          <Circle cx={24} cy={24} r={4} fill={GOLD} />
        </>
      )}
      {id === 'fish' && (
        <>
          <Path d="M8 24 Q20 12 32 24 Q20 36 8 24 Z" fill={BLUE} />
          <Path d="M31.5 24 L42 16.5 L42 31.5 Z" fill={BLUE} />
          <Circle cx={14} cy={22} r={1.8} fill="#0B0E23" />
          <Path d="M11 27 Q13 28.5 15 27" stroke="#0B0E23" strokeWidth={1.4} fill="none" strokeLinecap="round" />
        </>
      )}
    </Svg>
  );
}
