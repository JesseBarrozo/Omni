import { useMemo, useState } from "react";
import { ChevronDown, GitBranch } from "lucide-react";

export type GitCommit = { id: string; hash: string; parents: string[]; subject: string; author: string; age: string; refs: string[] };
type Segment = { from: number; to: number; color: number; startsAtNode?: boolean };
type GraphRow = { commit: GitCommit; lane: number; incoming: boolean; segments: Segment[]; columns: number };

// Git supplies commits in topological order. Keep each live parent in its own lane.
function buildGraph(commits: GitCommit[]): GraphRow[] {
  let lanes: (string | null)[] = [];
  return commits.map((commit) => {
    let lane = lanes.indexOf(commit.id);
    const incoming = lane !== -1;
    if (lane === -1) {
      lane = lanes.indexOf(null);
      if (lane === -1) lane = lanes.length;
      lanes[lane] = commit.id;
    }
    const previous = [...lanes];
    const next = [...lanes];
    next[lane] = null;
    const targets: number[] = [];
    for (const parent of commit.parents) {
      let target = next.indexOf(parent);
      if (target === -1) {
        target = targets.length === 0 && next[lane] === null ? lane : next.indexOf(null);
        if (target === -1) target = next.length;
        next[target] = parent;
      }
      targets.push(target);
    }
    const segments: Segment[] = previous.flatMap((hash, column) => hash && column !== lane ? [{ from: column, to: column, color: column }] : []);
    targets.forEach((target) => segments.push({ from: lane, to: target, color: target, startsAtNode: true }));
    while (next.length && next[next.length - 1] === null) next.pop();
    lanes = next;
    return { commit, lane, incoming, segments, columns: Math.max(previous.length, next.length, lane + 1) };
  });
}

const colors = ["var(--primary)", "#c084fc", "#43c59e", "#58a6ff", "#f18586"];
export function GitHistory({ commits, branch, onOpen }: { commits: GitCommit[]; branch: string; onOpen: (commit: GitCommit) => void }) {
  const [expanded, setExpanded] = useState(true);
  const rows = useMemo(() => buildGraph(commits), [commits]);
  const columns = Math.max(1, ...rows.map((row) => row.columns));
  const graphWidth = columns * 14 + 4;
  return (
    <section className="source-history" aria-label="Historique des commits">
      <button type="button" className="source-history-heading" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <ChevronDown className={expanded ? "" : "is-collapsed"} /> <span>Historique</span>
        {branch && <span className="source-history-current"><GitBranch /> {branch}</span>}
        <small>{commits.length}</small>
      </button>
      {expanded && <div className="source-history-list">
        {rows.map(({ commit, lane, incoming, segments }) => {
          const x = (column: number) => 9 + column * 14;
          const color = colors[lane % colors.length];
          return <button type="button" key={commit.id} className="source-history-row" title={`${commit.subject}\n${commit.author} · ${commit.age}\n${commit.hash}`} onClick={() => onOpen(commit)}>
            <svg aria-hidden="true" className="source-history-graph" width={graphWidth} height="30" viewBox={`0 0 ${graphWidth} 30`}>
              {incoming && <path d={`M ${x(lane)} 0 L ${x(lane)} 15`} stroke={color} />}
              {segments.map((segment, index) => <path key={index} d={segment.startsAtNode ? `M ${x(segment.from)} 15 C ${x(segment.from)} 23, ${x(segment.to)} 22, ${x(segment.to)} 30` : `M ${x(segment.from)} 0 L ${x(segment.to)} 30`} stroke={colors[segment.color % colors.length]} />)}
              <circle cx={x(lane)} cy="15" r={commit.refs.includes(branch) && branch ? "5" : "4"} fill={commit.refs.includes(branch) && branch ? "var(--card)" : color} stroke={color} strokeWidth="2" />
            </svg>
            <span className="source-history-subject">{commit.subject}</span>
            {commit.refs.slice(0, 2).map((ref) => <span key={ref} className={`source-history-ref${ref === branch ? " current" : ""}`}>{ref}</span>)}
            <span className="source-history-author">{commit.author}</span>
          </button>;
        })}
        {!rows.length && <p className="inspector-hint">Aucun commit disponible.</p>}
      </div>}
    </section>
  );
}
