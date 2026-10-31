/**
 * plotly.js-dist-min 最小类型声明。
 * 只声明本项目实际调用的成员；数据/布局结构由 sceneToPlotly.ts 负责。
 */
declare module 'plotly.js-dist-min' {
  interface PlotlyConfig {
    responsive?: boolean;
    displaylogo?: boolean;
    doubleClick?: boolean | 'reset' | 'autosize' | 'reset+autosize';
    scrollZoom?: boolean;
    modeBarButtonsToRemove?: string[];
    toImageButtonOptions?: Record<string, unknown>;
  }

  interface PlotlyStatic {
    react(
      element: HTMLElement | string,
      data: unknown[],
      layout?: Record<string, unknown>,
      config?: PlotlyConfig,
    ): Promise<unknown>;
    newPlot(
      element: HTMLElement | string,
      data: unknown[],
      layout?: Record<string, unknown>,
      config?: PlotlyConfig,
    ): Promise<unknown>;
    relayout(element: HTMLElement | string, update: Record<string, unknown>): Promise<unknown>;
    purge(element: HTMLElement | string): void;
    Plots: {
      resize(element: HTMLElement | string): void;
    };
  }

  const Plotly: PlotlyStatic;
  export default Plotly;
}
