interface Point {
    x: number;
    y: number;
}

export function calculateVisionPolygon(
    origin: Point,
    angleDeg: number,
    fovDeg: number,
    radius: number,
    walls: { x: number, y: number, w: number, h: number }[],
    rayCount: number = 60
): Point[] {
    const points: Point[] = [origin];
    const startAngle = (angleDeg - fovDeg / 2) * (Math.PI / 180);
    const endAngle = (angleDeg + fovDeg / 2) * (Math.PI / 180);
    const step = (endAngle - startAngle) / (rayCount - 1);

    for (let i = 0; i < rayCount; i++) {
        const angle = startAngle + step * i;
        const rayDir = { x: Math.cos(angle), y: Math.sin(angle) };
        const rayEnd = {
            x: origin.x + rayDir.x * radius,
            y: origin.y + rayDir.y * radius
        };

        let closestPoint = rayEnd;
        let minDistSq = radius * radius;

        // Check intersection with all walls
        for (const obs of walls) {
            const intersection = getRayRectIntersection(origin, rayEnd, obs);
            if (intersection) {
                const dx = intersection.x - origin.x;
                const dy = intersection.y - origin.y;
                const distSq = dx * dx + dy * dy;
                if (distSq < minDistSq) {
                    minDistSq = distSq;
                    closestPoint = intersection;
                }
            }
        }
        points.push(closestPoint);
    }

    // Close the polygon if needed, but array of points is fine for fillPoints
    return points;
}

function getRayRectIntersection(p1: Point, p2: Point, rect: { x: number, y: number, w: number, h: number }): Point | null {
    // Rect boundaries
    const left = rect.x - rect.w / 2;
    const right = rect.x + rect.w / 2;
    const top = rect.y - rect.h / 2;
    const bottom = rect.y + rect.h / 2;

    // Check bounding box first
    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);

    if (maxX < left || minX > right || maxY < top || minY > bottom) return null;

    let closest: Point | null = null;
    let minDist = Infinity;

    // Edges: Left, Right, Top, Bottom
    const edges = [
        { a: { x: left, y: top }, b: { x: left, y: bottom } },
        { a: { x: right, y: top }, b: { x: right, y: bottom } },
        { a: { x: left, y: top }, b: { x: right, y: top } },
        { a: { x: left, y: bottom }, b: { x: right, y: bottom } }
    ];

    for (const edge of edges) {
        const pt = getLineIntersection(p1, p2, edge.a, edge.b);
        if (pt) {
            const dx = pt.x - p1.x;
            const dy = pt.y - p1.y;
            const d = dx * dx + dy * dy;
            if (d < minDist) {
                minDist = d;
                closest = pt;
            }
        }
    }

    return closest;
}

function getLineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
    const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
    const x3 = p3.x, y3 = p3.y, x4 = p4.x, y4 = p4.y;

    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (denom === 0) return null;

    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

    if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
        return {
            x: x1 + ua * (x2 - x1),
            y: y1 + ua * (y2 - y1)
        };
    }
    return null;
}

export function isPointVisible(
    origin: Point,
    target: Point,
    walls: { x: number, y: number, w: number, h: number }[]
): boolean {
    // Check if line segment intersects any wall
    for (const wall of walls) {
        // Simple bounding box check first
        const minX = Math.min(origin.x, target.x);
        const maxX = Math.max(origin.x, target.x);
        const minY = Math.min(origin.y, target.y);
        const maxY = Math.max(origin.y, target.y);

        const left = wall.x - wall.w / 2;
        const right = wall.x + wall.w / 2;
        const top = wall.y - wall.h / 2;
        const bottom = wall.y + wall.h / 2;

        if (maxX < left || minX > right || maxY < top || minY > bottom) continue;

        // Detailed intersection check
        const intersection = getRayRectIntersection(origin, target, wall);
        if (intersection) {
            // Check if intersection is strictly between origin and target (excluding endpoints usually, but here obstacles are solid)
            // getRayRectIntersection returns closest point on ray. We need to check if it's closer than target.
            const distToTargetSq = (target.x - origin.x) ** 2 + (target.y - origin.y) ** 2;
            const distToHitSq = (intersection.x - origin.x) ** 2 + (intersection.y - origin.y) ** 2;

            // If hit is closer than target (with small epsilon), then blocked
            if (distToHitSq < distToTargetSq - 0.1) {
                return false;
            }
        }
    }
    return true;
}
