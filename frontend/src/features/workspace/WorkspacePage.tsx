import { SamplePanel } from './SamplePanel';
import { SampleTable } from './SampleTable';
import { Inspector } from './Inspector';
import { PlotWorkspace } from '../plot/PlotWorkspace';

/** 工作台：左筛选、中画图与记录表、右变量/图层/样式/版面。 */
export function WorkspacePage() {
  return (
    <>
      <SamplePanel />
      <div className="center">
        <PlotWorkspace />
        <SampleTable />
      </div>
      <Inspector />
    </>
  );
}
