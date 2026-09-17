import type { ProcessDefinition, Resource } from './engine/types';

export function WorkcellEditor({
  definition,
  onAdd,
  onUpdate,
  onAssign,
  onDelete,
  onFitNames,
}: {
  definition: ProcessDefinition;
  onAdd: () => void;
  onUpdate: (workcellId: string, patch: { label?: string; location?: string; calendarId?: string }) => void;
  onAssign: (resourceId: string, workcellId: string) => void;
  onDelete: (workcellId: string) => void;
  onFitNames?: () => void;
}) {
  const last = definition.workcells.length <= 1;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Workcells</h2>
        <div className="panel-head-actions">
          {onFitNames && (
            <button
              type="button"
              className="btn"
              onClick={onFitNames}
              title="Widen the left panel to the longest resource name"
            >
              Fit names
            </button>
          )}
          <button type="button" className="btn" onClick={onAdd}>
            Add workcell
          </button>
        </div>
      </div>
      <p className="hint">
        Geography for resources. A sequence that crosses cells needs a transfer — moving a resource
        adds one at duration 0.
      </p>
      {definition.workcells.map((cell) => (
        <div key={cell.id} className="cell-card">
          <div className="cell-head">
            <label>
              Name
              <input
                className="field"
                value={cell.label}
                onChange={(e) => onUpdate(cell.id, { label: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={last}
              title={last ? 'A process needs at least one workcell' : `Delete ${cell.label}`}
              onClick={() => onDelete(cell.id)}
            >
              Delete
            </button>
          </div>
          <div className="cell-fields">
            <label>
              Location
              <input
                className="field"
                placeholder="optional"
                value={cell.location ?? ''}
                onChange={(e) => onUpdate(cell.id, { location: e.target.value })}
              />
            </label>
            <label>
              Calendar
              <input
                className="field"
                value={cell.calendarId}
                onChange={(e) => onUpdate(cell.id, { calendarId: e.target.value })}
              />
            </label>
          </div>
          <p className="cell-count">
            {cell.resourceIds.length === 1 ? '1 resource' : `${cell.resourceIds.length} resources`}
          </p>
          <ul className="res-list">
            {resourcesIn(definition, cell.id).map((resource) => (
              <li key={resource.id} className="res-row">
                <span>{resource.name}</span>
                <select
                  className="field"
                  value={cell.id}
                  onChange={(e) => onAssign(resource.id, e.target.value)}
                  aria-label={`Move ${resource.name}`}
                >
                  {definition.workcells.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function resourcesIn(def: ProcessDefinition, workcellId: string): Resource[] {
  return def.resources.filter((r) => r.workcellId === workcellId);
}
