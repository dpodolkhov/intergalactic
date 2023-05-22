import { CProps, ReturnEl } from '@semcore/core';
import { RefObject } from 'react';
import { IBoxProps } from '@semcore/flex-box';
import { ITooltipProps } from '@semcore/tooltip';

export interface IEllipsisProps extends IBoxProps, ITooltipProps {
  /**
   * Rows count in multiline Ellipsis
   * @default 1
   */
  maxLine?: number;
  /**
   * Trimming type
   * @default end
   */
  trim?: 'end' | 'middle';
  /**
   * Show tooltip
   * @default true
   */
  tooltip?: boolean;
  /**
   * Ref to the item that will be observed by ResizeObserver
   */
  // eslint-disable-next-line ssr-friendly/no-dom-globals-in-module-scope
  containerRef?: RefObject<HTMLElement | null>;
  /**
   * Explicit sizes of container text should be trimmed in
   **/
  containerRect?: { width: number };
  /** List of props that will be passed to tooltip
   * @default ['title', 'theme', 'strategy', 'modifiers', 'placement', 'interaction', 'timeout', 'visible', 'defaultVisible', 'onVisibleChange', 'offset', 'preventOverflow', 'arrow', 'flip', 'computeStyles', 'eventListeners', 'onFirstUpdate']
   */
  includeTooltipProps?: string[];
}

declare const useResizeObserver: (
  ref: RefObject<HTMLElement>,
  hookOverride?: { width: number },
) => { width: number };

declare const Ellipsis: <T>(props: CProps<IEllipsisProps & T>) => ReturnEl;

export { useResizeObserver };
export default Ellipsis;
