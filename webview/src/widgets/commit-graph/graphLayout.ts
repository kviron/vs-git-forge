/**
 * Упрощённый граф коммитов по идее vscode-git-graph (Vertex/Branch/линии в SVG).
 * Коммиты передаются от нового к старому (index 0 = HEAD).
 */

const NULL_ID = -1;

export interface Point {
  x: number;
  y: number;
}

class Branch {
  private colour: number;
  private lines: Array<{ p1: Point; p2: Point; committed: boolean; lockedFirst: boolean }> = [];

  constructor(colour: number) {
    this.colour = colour;
  }

  addLine(p1: Point, p2: Point, committed: boolean, lockedFirst: boolean) {
    this.lines.push({ p1, p2, committed, lockedFirst });
  }

  getColour() {
    return this.colour;
  }

  getLines() {
    return this.lines;
  }
}

class Vertex {
  readonly id: number;
  private x = 0;
  private children: Vertex[] = [];
  private parents: Vertex[] = [];
  private nextParent = 0;
  private onBranch: Branch | null = null;
  private connections: Array<{ connectsTo: Vertex | null; onBranch: Branch }> = [];
  private nextX = 0;
  isCurrent = false;

  constructor(id: number) {
    this.id = id;
  }

  addChild(v: Vertex) {
    this.children.push(v);
  }
  addParent(v: Vertex) {
    this.parents.push(v);
  }
  getParents(): ReadonlyArray<Vertex> {
    return this.parents;
  }
  getNextParent(): Vertex | null {
    return this.nextParent < this.parents.length ? this.parents[this.nextParent] : null;
  }
  registerParentProcessed() {
    this.nextParent++;
  }
  isMerge() {
    return this.parents.length > 1;
  }

  addToBranch(branch: Branch, x: number) {
    if (this.onBranch === null) {
      this.onBranch = branch;
      this.x = x;
    }
  }
  isNotOnBranch() {
    return this.onBranch === null;
  }
  getBranch() {
    return this.onBranch;
  }
  getPoint(): Point {
    return { x: this.x, y: this.id };
  }
  getNextPoint(): Point {
    return { x: this.nextX, y: this.id };
  }
  getPointConnectingTo(vertex: Vertex | null, onBranch: Branch): Point | null {
    for (let i = 0; i < this.connections.length; i++) {
      if (this.connections[i].connectsTo === vertex && this.connections[i].onBranch === onBranch) {
        return { x: i, y: this.id };
      }
    }
    return null;
  }
  registerUnavailablePoint(x: number, connectsTo: Vertex | null, onBranch: Branch) {
    if (x === this.nextX) {
      this.nextX = x + 1;
      this.connections[x] = { connectsTo, onBranch };
    }
  }
  getColour() {
    return this.onBranch !== null ? this.onBranch.getColour() : 0;
  }
}

export interface GraphConfig {
  grid: { x: number; y: number; offsetX: number; offsetY: number };
  colours: string[];
}

function toPixel(p: Point, config: GraphConfig): { x: number; y: number } {
  return {
    x: p.x * config.grid.x + config.grid.offsetX,
    y: p.y * config.grid.y + config.grid.offsetY,
  };
}

function drawPath(
  svg: SVGElement,
  pathD: string,
  committed: boolean,
  colour: string,
  ns: string
) {
  const line = document.createElementNS(ns, "path");
  line.setAttribute("class", "commit-graph-line");
  line.setAttribute("d", pathD);
  line.setAttribute("stroke", committed ? colour : "#808080");
  line.setAttribute("fill", "none");
  line.setAttribute("stroke-width", "2");
  svg.appendChild(line);
}

function buildPathD(
  lines: Array<{ p1: Point; p2: Point; committed: boolean; lockedFirst: boolean }>,
  config: GraphConfig
): string {
  const d = config.grid.y * 0.38;
  let pathD = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const p1 = toPixel(line.p1, config);
    const p2 = toPixel(line.p2, config);
    if (pathD === "" || (i > 0 && (p1.x !== toPixel(lines[i - 1].p2, config).x || p1.y !== toPixel(lines[i - 1].p2, config).y))) {
      pathD += `M${p1.x.toFixed(0)},${p1.y.toFixed(1)}`;
    }
    if (p1.x === p2.x) {
      pathD += `L${p2.x.toFixed(0)},${p2.y.toFixed(1)}`;
    } else {
      if (line.lockedFirst) {
        pathD += `L${p2.x.toFixed(0)},${(p2.y - d).toFixed(1)}L${p2.x.toFixed(0)},${p2.y.toFixed(1)}`;
      } else {
        pathD += `L${p1.x.toFixed(0)},${(p1.y + d).toFixed(1)}L${p2.x.toFixed(0)},${p2.y.toFixed(1)}`;
      }
    }
  }
  return pathD;
}

export function buildGraph(
  commits: Array<{ hash: string; shortHash: string; parents?: string[] }>,
  commitLookup: Record<string, number>,
  headHash: string | null,
  onlyFollowFirstParent: boolean
): {
  vertices: Vertex[];
  branches: Branch[];
  config: GraphConfig;
} {
  const NULL_VERTEX = new Vertex(NULL_ID);
  const vertices: Vertex[] = [];
  const branches: Branch[] = [];
  const availableColours: number[] = [];

  if (commits.length === 0) {
    return {
      vertices: [],
      branches: [],
      config: {
        grid: { x: 16, y: 28, offsetX: 12, offsetY: 12 },
        colours: ["#4ec9b0", "#89d185", "#ce9178", "#dcdcaa", "#c586c0"],
      },
    };
  }

  for (let i = 0; i < commits.length; i++) {
    vertices.push(new Vertex(i));
  }
  for (let i = 0; i < commits.length; i++) {
    const parents = commits[i].parents ?? [];
    for (let j = 0; j < parents.length; j++) {
      const parentHash = parents[j];
      const parentIndex = commitLookup[parentHash];
      if (typeof parentIndex === "number") {
        vertices[i].addParent(vertices[parentIndex]);
        vertices[parentIndex].addChild(vertices[i]);
      } else if (!onlyFollowFirstParent || j === 0) {
        vertices[i].addParent(NULL_VERTEX);
      }
    }
  }

  if (headHash !== null && typeof commitLookup[headHash] === "number") {
    vertices[commitLookup[headHash]].isCurrent = true;
  }

  function getAvailableColour(startAt: number): number {
    for (let i = 0; i < availableColours.length; i++) {
      if (startAt > availableColours[i]) return i;
    }
    availableColours.push(0);
    return availableColours.length - 1;
  }

  function determinePath(startAt: number) {
    let i = startAt;
    let vertex = vertices[i];
    let parentVertex = vertex.getNextParent();
    let lastPoint = vertex.isNotOnBranch() ? vertex.getNextPoint() : vertex.getPoint();
    let curPoint: Point;

    if (
      parentVertex !== null &&
      parentVertex.id !== NULL_ID &&
      vertex.isMerge() &&
      !vertex.isNotOnBranch() &&
      !parentVertex.isNotOnBranch()
    ) {
      const parentBranch = parentVertex.getBranch()!;
      vertex.addToBranch(parentBranch, lastPoint.x);
      vertex.registerUnavailablePoint(lastPoint.x, vertex, parentBranch);
      let foundPointToParent = false;
      for (i = startAt + 1; i < vertices.length; i++) {
        const curVertex = vertices[i];
        curPoint =
          curVertex.getPointConnectingTo(parentVertex, parentBranch) ??
          curVertex.getNextPoint();
        parentBranch.addLine(lastPoint, curPoint, true, !foundPointToParent && curVertex !== parentVertex ? lastPoint.x < curPoint.x : true);
        curVertex.registerUnavailablePoint(curPoint.x, parentVertex, parentBranch);
        lastPoint = curPoint;
        if (curVertex.getPointConnectingTo(parentVertex, parentBranch) !== null) {
          foundPointToParent = true;
        }
        if (foundPointToParent) {
          vertex.registerParentProcessed();
          break;
        }
      }
    } else {
      const branch = new Branch(getAvailableColour(startAt));
      vertex.addToBranch(branch, lastPoint.x);
      vertex.registerUnavailablePoint(lastPoint.x, vertex, branch);
      for (i = startAt + 1; i < vertices.length; i++) {
        const curVertex = vertices[i];
        curPoint =
          parentVertex === curVertex && !parentVertex.isNotOnBranch()
            ? curVertex.getPoint()
            : curVertex.getNextPoint();
        branch.addLine(lastPoint, curPoint, true, lastPoint.x < curPoint.x);
        curVertex.registerUnavailablePoint(curPoint.x, parentVertex, branch);
        lastPoint = curPoint;
        if (parentVertex === curVertex) {
          vertex.registerParentProcessed();
          const parentOnBranch = !parentVertex.isNotOnBranch();
          parentVertex.addToBranch(branch, curPoint.x);
          vertex = parentVertex;
          parentVertex = vertex.getNextParent();
          if (parentVertex === null || parentOnBranch) break;
        }
      }
      if (i === vertices.length && parentVertex !== null && parentVertex.id === NULL_ID) {
        vertex.registerParentProcessed();
      }
      branches.push(branch);
      availableColours[branch.getColour()] = i;
    }
  }

  let i = 0;
  while (i < vertices.length) {
    if (vertices[i].getNextParent() !== null || vertices[i].isNotOnBranch()) {
      determinePath(i);
    } else {
      i++;
    }
  }

  const config: GraphConfig = {
    grid: { x: 16, y: 28, offsetX: 12, offsetY: 12 },
    colours: ["#4ec9b0", "#89d185", "#ce9178", "#dcdcaa", "#c586c0"],
  };

  return { vertices, branches, config };
}

const SVG_NS = "http://www.w3.org/2000/svg";

export interface RenderGraphOptions {
  /** Индекс вершины «Uncommitted Changes» — рисуется как контур (outline), без заливки */
  uncommittedVertexIndex?: number;
}

export function renderGraphToSvg(
  vertices: Vertex[],
  branches: Branch[],
  config: GraphConfig,
  options: RenderGraphOptions = {}
): SVGElement {
  const { uncommittedVertexIndex } = options;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "commit-graph-svg");

  const maxX = vertices.length > 0 ? Math.max(...vertices.map((v) => v.getNextPoint().x)) : 0;
  const contentWidth =
    2 * config.grid.offsetX + Math.max(0, (maxX - 1) * config.grid.x);
  const height = vertices.length * config.grid.y + config.grid.offsetY - config.grid.y / 2;
  svg.setAttribute("width", String(contentWidth));
  svg.setAttribute("height", String(height));

  for (const branch of branches) {
    const colour = config.colours[branch.getColour() % config.colours.length];
    const pathD = buildPathD(branch.getLines(), config);
    if (pathD) {
      drawPath(svg, pathD, true, colour, SVG_NS);
    }
  }

  for (const v of vertices) {
    if (v.getBranch() === null) continue;
    const colour = config.colours[v.getColour() % config.colours.length];
    const p = toPixel(v.getPoint(), config);
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("data-commit-index", String(v.id));
    circle.setAttribute("data-commit-colour", colour);
    circle.setAttribute("cx", String(p.x));
    circle.setAttribute("cy", String(p.y));
    circle.setAttribute("r", "4");
    const isUncommitted = uncommittedVertexIndex !== undefined && v.id === uncommittedVertexIndex;
    if (isUncommitted) {
      circle.setAttribute("class", "commit-graph-node commit-graph-node--uncommitted");
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", colour);
      circle.setAttribute("stroke-width", "2");
    } else if (v.isCurrent) {
      circle.setAttribute("class", "commit-graph-node commit-graph-node--current");
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", colour);
      circle.setAttribute("stroke-width", "2");
    } else {
      circle.setAttribute("class", "commit-graph-node");
      circle.setAttribute("fill", colour);
    }
    svg.appendChild(circle);
  }

  return svg;
}
