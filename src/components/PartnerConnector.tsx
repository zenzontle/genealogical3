import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

export type PartnerNode = Node<
  {
    partnerId: string;
    label: string;
    onSelect: (id: string) => void;
  },
  'partnerConnector'
>;

// The edge paints the heart; this transparent node makes its midpoint connectable.
export function PartnerConnector({ data }: NodeProps<PartnerNode>) {
  return (
    <div
      className="partner-connector nodrag nopan"
      role="button"
      tabIndex={0}
      aria-label={data.label}
      onClick={() => data.onSelect(data.partnerId)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          data.onSelect(data.partnerId);
        }
      }}
    >
      <Handle
        id="child"
        type="source"
        position={Position.Bottom}
        className="partner-child-handle"
        title="Drag to a person to connect them as a child of both partners"
      />
    </div>
  );
}
