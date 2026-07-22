<script lang="ts">
	import { untrack } from "svelte";

	import {
		aimAngle,
		CANNON_BASE_RATIO,
		cannonLength,
		clampStageWidth,
		createBall,
		createWorld,
		FIXED_DT,
		launchVelocity,
		MAX_BALLS,
		muzzle,
		predictLanding,
		predictPath,
		railRange,
		sandboxWorld,
		stageOffset,
		stepAll,
		wedgeGeometry,
		type Ball,
		type Obstacle,
		type World
	} from "$lib/physics";
	import { apparatus } from "$lib/stores/apparatus.svelte";
	import {
		balls,
		launchBall,
		nextSlot,
		projectEntered,
		removeBall,
		slotFor
	} from "$lib/stores/balls";
	import { charset, syncCharset } from "$lib/stores/charset.svelte";
	import { checkInstantFail, CODE_LENGTH, game, newTarget } from "$lib/stores/game.svelte";
	import { hover } from "$lib/stores/hover.svelte";
	import { pegs } from "$lib/stores/pegs.svelte";
	import { settings } from "$lib/stores/settings.svelte";
	import { FIRE_BAR_HEIGHT, touch } from "$lib/stores/touch.svelte";

	let DOME_FILL = "#fff";
	let WEDGE_FILL = "#fff"; // the win-screen funnel ramps
	let OBSTACLE_FILL = "#fff";
	let LETTER_FILL = "rgba(255, 255, 255, 0.7)";
	let LETTER_GREEN = "rgba(74, 222, 128, 0.95)"; // the target letter when the aim is on it
	let BALL_FILL = "#e5e5e5";
	let BALL_HIGHLIGHT = "#ffffff"; // specular highlight on the ball's gradient
	let TRAJECTORY_RGB = "255, 70, 70";
	let TRAJECTORY_GREEN = "74, 222, 128"; // preview + slot go green when the shot lands on target
	let TRAJECTORY_ALPHA = 0.95;
	let TRAJECTORY_DASH_SPEED = 12; // px/sec the dots pan toward the target
	let PEG_LINE = "rgba(255, 255, 255, 0.3)";
	let EDGE_LINE = "rgba(255, 255, 255, 0.2)"; // light gray border at the stage edges
	let SANDBOX_SPAWN_MS = 120; // win-screen auto-stream cadence (~8 balls/sec)

	let canvas: HTMLCanvasElement;

	// the light gray borders marking the left/right edges of the (capped) play area
	const drawEdges = (ctx: CanvasRenderingContext2D, world: World): void => {
		ctx.fillStyle = EDGE_LINE;
		ctx.fillRect(0, 0, 2, world.height);
		ctx.fillRect(world.width - 2, 0, 2, world.height);
		// during play on touch the floor is raised to make room for the Fire button;
		// close off the play area with a matching border along the bottom, above it
		if (touch.coarse && game.status === "playing")
			ctx.fillRect(0, world.height - 2, world.width, 2);
	};

	// red aim preview: the deterministic path a ball fired now would trace through
	// its first N collisions (N = settings.guidelineBounces), as marching dots that
	// fade out near the end
	const drawTrajectory = (
		ctx: CanvasRenderingContext2D,
		world: World,
		time: number,
		correct: boolean,
		collideWorld: World,
		blockers: Obstacle[]
	): void => {
		const rgb = correct ? TRAJECTORY_GREEN : TRAJECTORY_RGB;
		const m = muzzle(apparatus.x, world.cupWidth, apparatus.angle);
		const vel = launchVelocity(apparatus.angle);
		// the guideline is predicted against whichever world is live — the play
		// board, or the win-screen funnel — plus the resting balls as blockers, so
		// it bends around the existing pile and matches what's drawn. The number of
		// collisions traced is player-configurable.
		const path = predictPath(
			collideWorld,
			m.x,
			m.y,
			vel.x,
			vel.y,
			settings.guidelineBounces,
			blockers
		);
		if (path.length < 2) return;

		// cumulative distance along the path (so dashes stay continuous across
		// segments and the tail can fade by distance rather than by point index)
		const dist = [0];
		for (let i = 1; i < path.length; i++) {
			dist[i] = dist[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
		}
		const total = dist[path.length - 1];
		if (total === 0) return;

		const fadeStart = total * 0.75; // last quarter fades to nothing
		const march = (time / 1000) * TRAJECTORY_DASH_SPEED;

		ctx.lineWidth = 3;
		ctx.setLineDash([8, 8]);
		for (let i = 1; i < path.length; i++) {
			const mid = (dist[i - 1] + dist[i]) / 2;
			const fade = mid <= fadeStart ? 1 : Math.max(0, 1 - (mid - fadeStart) / (total - fadeStart));
			ctx.strokeStyle = `rgba(${rgb}, ${TRAJECTORY_ALPHA * fade})`;
			ctx.lineDashOffset = dist[i - 1] - march; // continuous pattern, panning toward target
			ctx.beginPath();
			ctx.moveTo(path[i - 1].x, path[i - 1].y);
			ctx.lineTo(path[i].x, path[i].y);
			ctx.stroke();
		}
		ctx.setLineDash([]); // don't dash everything drawn afterward
	};

	// the white humps between cups — each is a filled upper half-disk on the floor
	const drawDomes = (ctx: CanvasRenderingContext2D, world: World): void => {
		ctx.fillStyle = DOME_FILL;
		for (const dome of world.domes) {
			ctx.beginPath();
			ctx.arc(dome.center.x, dome.center.y, dome.radius, Math.PI, 0, false);
			ctx.fill();
		}
	};

	// a soft green glow rising out of the target slot when the current aim would
	// land the ball there — drawn under the domes so it reads as light coming up
	// through the slot opening, with a gentle breathing pulse
	const drawSlotGlow = (
		ctx: CanvasRenderingContext2D,
		world: World,
		centerX: number,
		time: number
	): void => {
		const cy = world.height; // the floor — glow rises up out of the slot opening
		const r = world.domeRadius * 1.3; // concentrated to the opening, not the whole cup
		const pulse = 0.16 + 0.06 * Math.sin(time / 350);
		const g = ctx.createRadialGradient(centerX, cy, 0, centerX, cy, r);
		g.addColorStop(0, `rgba(${TRAJECTORY_GREEN}, ${pulse})`);
		g.addColorStop(1, `rgba(${TRAJECTORY_GREEN}, 0)`);
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc(centerX, cy, r, 0, Math.PI * 2);
		ctx.fill();
	};

	// the win-screen funnel: two mirrored solid wedges angling down to the center
	// drain gap (the ramp surfaces are the colliders; this just fills them in)
	const drawWedges = (ctx: CanvasRenderingContext2D, world: World): void => {
		const w = wedgeGeometry(world.width, world.height);
		ctx.fillStyle = WEDGE_FILL;
		ctx.beginPath();
		ctx.moveTo(0, w.topY);
		ctx.lineTo(w.gapLeftX, w.floorY);
		ctx.lineTo(0, w.floorY);
		ctx.closePath();
		ctx.fill();
		ctx.beginPath();
		ctx.moveTo(world.width, w.topY);
		ctx.lineTo(w.gapRightX, w.floorY);
		ctx.lineTo(world.width, w.floorY);
		ctx.closePath();
		ctx.fill();
	};

	// the rail line the pegs ride on: a thin gray dotted line spanning the screen to
	// the edge handles. Part of the "rail handles" control, drawn only with them.
	const drawPegLine = (ctx: CanvasRenderingContext2D, world: World): void => {
		ctx.strokeStyle = PEG_LINE;
		ctx.lineWidth = 2;
		ctx.lineCap = "round";
		ctx.setLineDash([0, 8]); // round dots across the rail
		ctx.lineDashOffset = 0; // stationary — the trajectory leaves a marching offset
		ctx.beginPath();
		ctx.moveTo(0, pegs.y);
		ctx.lineTo(world.width, pegs.y);
		ctx.stroke();
		ctx.setLineDash([]); // reset so nothing drawn afterward inherits the dash
		ctx.lineCap = "butt";
	};

	// the white pegs the ball bounces off, riding at the rail's current height
	const drawPegs = (ctx: CanvasRenderingContext2D, world: World): void => {
		ctx.fillStyle = OBSTACLE_FILL;
		for (const o of world.obstacles) {
			ctx.beginPath();
			ctx.arc(o.center.x, o.center.y, o.radius, 0, Math.PI * 2);
			ctx.fill();
		}
	};

	// Keep the peg row inside its travel range and push the result into the
	// physics. Recomputed every frame, so window resizes are handled for free:
	//   lowest  (largest y)  = the resting/default spot (letterY − one mound)
	//   highest (smallest y) = the same clearance the resting row has above the
	//                          mound tops, measured down from the apparatus mouth
	const positionPegRow = (world: World): void => {
		// reference the cannon's straight-down reach (fixed) so the rail's range
		// doesn't shift as the cannon aims
		const reach = cannonLength(world.cupWidth);
		const { lowest, highest } = railRange(world.letterY, world.domeRadius, reach);
		pegs.min = lowest;
		pegs.max = highest;
		// without the rail handles the row can't be repositioned — it sits at its
		// default resting spot
		if (!settings.railHandles) {
			pegs.y = lowest;
			return;
		}
		if (pegs.y === 0) pegs.y = lowest; // start at rest
		pegs.y = Math.min(lowest, Math.max(highest, pegs.y));
	};

	// the letters sit in the catch slots between the domes
	const drawLetters = (ctx: CanvasRenderingContext2D, world: World, glowX: number | null): void => {
		ctx.font = "bold 16px system-ui, sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		for (const cup of world.cups) {
			ctx.fillStyle = cup.centerX === glowX ? LETTER_GREEN : LETTER_FILL;
			ctx.fillText(cup.letter, cup.centerX, world.letterY);
		}
	};

	const drawBall = (ctx: CanvasRenderingContext2D, ball: Ball, alpha = 1): void => {
		// interpolate between previous and current physics position for sub-frame smoothness
		const prev = ball.prevPos ?? ball.pos;
		const x = ball.resting ? ball.pos.x : prev.x + (ball.pos.x - prev.x) * alpha;
		const y = ball.resting ? ball.pos.y : prev.y + (ball.pos.y - prev.y) * alpha;
		const r = ball.radius;
		// radial gradient for a soft, polished sphere look
		const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
		grad.addColorStop(0, BALL_HIGHLIGHT);
		grad.addColorStop(1, BALL_FILL);
		ctx.beginPath();
		ctx.fillStyle = grad;
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.fill();
	};

	$effect(() => {
		const ctx = canvas.getContext("2d")!;
		let world!: World;
		let sandbox!: World; // win-screen funnel world, rebuilt on resize alongside `world`
		let stageX = 0; // left offset of the centered play area within the window

		// Create a temporary element to fully resolve CSS variables (handles var(--...) nesting)
		const getResolvedColor = (cssVar: string, fallback: string) => {
			const div = document.createElement('div');
			div.style.color = `var(${cssVar}, ${fallback})`;
			div.style.display = 'none';
			document.body.appendChild(div);
			const resolved = getComputedStyle(div).color; // returns "rgb(r, g, b)"
			document.body.removeChild(div);
			return resolved;
		};

		const rgbStringToTuple = (rgbStr: string) => {
			const match = rgbStr.match(/\d+/g);
			return match ? `${match[0]}, ${match[1]}, ${match[2]}` : "255, 255, 255";
		};

		const getTuple = (cssVar: string, fallback: string) => rgbStringToTuple(getResolvedColor(cssVar, fallback));

		DOME_FILL = getResolvedColor('--surface-bright', '#313244');
		WEDGE_FILL = DOME_FILL;
		OBSTACLE_FILL = getResolvedColor('--secondary', '#7dc4e4'); // Using secondary color for pegs
		LETTER_FILL = `rgba(${getTuple('--text-primary', '#cdd6f4')}, 1.0)`;
		
		const greenTuple = getTuple('--green', '#a6e3a1');
		LETTER_GREEN = `rgba(${greenTuple}, 0.95)`;
		TRAJECTORY_GREEN = greenTuple;
		
		const redTuple = getTuple('--red', '#f38ba8');
		TRAJECTORY_RGB = redTuple;
		
		BALL_FILL = getResolvedColor('--primary', '#cba6f7');
		PEG_LINE = `rgba(${getTuple('--text-muted', '#a6adc8')}, 0.3)`;
		EDGE_LINE = `rgba(${getTuple('--surface-bright', '#313244')}, 0.5)`;

		// Size/position the canvas to the (width-capped, centered) play area and
		// the device pixel ratio so the drawing stays crisp, then rebuild the cup
		// geometry for the new size.
		const resize = (): void => {
			const dpr = window.devicePixelRatio || 1;
			// on touch, reserve a bottom band for the Fire button by raising the floor:
			// the play area is the window minus that band, so the button sits isolated
			// below the cups (createWorld derives the whole board from this height). The
			// band only exists while the bar does — during play — so the win/lose screens
			// (no bar) use the full height with no empty gap.
			const h =
				window.innerHeight - (touch.coarse && game.status === "playing" ? FIRE_BAR_HEIGHT : 0);
			const sw = clampStageWidth(window.innerWidth);
			stageX = stageOffset(window.innerWidth);
			canvas.width = sw * dpr;
			canvas.height = h * dpr;
			canvas.style.width = `${sw}px`;
			canvas.style.height = `${h}px`;
			canvas.style.left = `${stageX}px`;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			// when a breakpoint is crossed, swap the value set (board rebuilds below)
			// and pick a fresh target — but keep the balls and progress in play
			if (syncCharset(sw)) newTarget();
			world = createWorld(sw, h, charset.values);
			sandbox = sandboxWorld(sw, h);
			// cannon pan position: center on first run, otherwise keep it on-stage
			const margin = world.cupWidth * CANNON_BASE_RATIO;
			apparatus.x =
				apparatus.x === 0 ? sw / 2 : Math.min(Math.max(apparatus.x, margin), sw - margin);
			// snap the rebuilt pegs to the rail's current spot so the next frame
			// doesn't sweep them up from the default position
			if (pegs.y > 0) for (const o of world.obstacles) o.center.y = pegs.y;
			// Pull balls back inside the resized viewport before re-settling — a
			// height shrink moves the floor up, and any ball left below it would
			// fall off-screen and vanish.
			for (const ball of balls) {
				ball.pos.x = Math.max(ball.radius, Math.min(sw - ball.radius, ball.pos.x));
				ball.pos.y = Math.max(ball.radius, Math.min(h - ball.radius, ball.pos.y));
				ball.resting = false; // re-settle into moved cups
			}
		};
		// untracked so this render effect doesn't re-run when the charset swaps —
		// the resize handler already rebuilds the world on a crossing
		untrack(resize);
		// re-lay out when the reserved Fire-button band should appear or clear: the
		// device's touch capability flips (mouse plugged in, devtools emulation), or
		// the game leaves/enters play (the band only exists during play)
		$effect(() => {
			touch.coarse;
			game.status;
			untrack(resize);
		});

		// which letter slot a settled ball came to rest in
		const slotLetterAt = (x: number): string => {
			const i = Math.max(0, Math.min(world.cups.length - 1, Math.floor(x / world.cupWidth)));
			return world.cups[i].letter;
		};

		let last = 0;
		let raf = 0;
		let acc = 0; // leftover time, advanced in fixed steps
		let lastSpawn = 0; // timestamp of the last win-screen auto-stream ball
		const frame = (time: number): void => {
			const container = document.getElementById('captcha-plinko-container');
			if (container && container.classList.contains('opacity-0')) {
				last = 0;
				raf = requestAnimationFrame(frame);
				return;
			}

			const dt = last ? Math.min((time - last) / 1000, 1 / 30) : 0;
			last = time;

			const playing = game.status === "playing";
			const inSandbox = game.status === "success";
			// Which world the sim + guideline collide against: the play board; the
			// win-screen funnel (wedges draining through a center gap); or, on a loss,
			// a plain bare floor.
			// pegs off → drop the obstacles from the world the sim + predictors collide
			// against, so the ball falls straight past where they'd be
			const simWorld = playing
				? settings.pegs
					? world
					: { ...world, obstacles: [] }
				: inSandbox
					? sandbox
					: { ...world, domes: [], obstacles: [] };

			if (playing) positionPegRow(world); // clamp the draggable row's target
			// Advance the sim in fixed steps so it's frame-rate independent and
			// repeatable — this is what makes the ball follow the preview path. In the
			// sandbox, rest detection is off (`settle: false`) so balls keep flowing
			// down the shallow ramps and drain instead of settling into a locked pile.
			acc += dt;
			while (acc >= FIXED_DT) {
				// snapshot positions before the step so we can interpolate at render time
				for (const b of balls) { b.prevPos = { x: b.pos.x, y: b.pos.y }; }
				const pegFromY = simWorld.obstacles.length ? simWorld.obstacles[0].center.y : pegs.y;
				stepAll(balls, simWorld, FIXED_DT, pegFromY, playing ? pegs.y : pegFromY, !inSandbox);
				acc -= FIXED_DT;
			}
			if (inSandbox) {
				// the win sandbox runs itself: the barrel is locked straight down (no
				// aiming) and pours a steady stream from the (still-pannable) cannon
				if (apparatus.angle !== 0) apparatus.angle = 0;
				if (time - lastSpawn >= SANDBOX_SPAWN_MS && balls.length < MAX_BALLS) {
					const m = muzzle(apparatus.x, world.cupWidth, 0);
					const vel = launchVelocity(0);
					balls.push(createBall(m.x, m.y, vel.x, vel.y));
					lastSpawn = time;
				}
				// drain: a ball that has fallen through the center gap and off the
				// bottom is wiped, which keeps the on-screen count self-limiting
				for (let k = balls.length - 1; k >= 0; k--) {
					if (balls[k].pos.y - balls[k].radius > world.height) balls.splice(k, 1);
				}
			}

			// resting balls are immovable circles for the predictors, so the guideline
			// and green indicator bend around / settle on the existing pile (only in
			// play — moving balls are left out, and there are none to read on a loss)
			const blockers: Obstacle[] = playing
				? balls
						.filter((b) => b.resting)
						.map((b) => ({ center: { x: b.pos.x, y: b.pos.y }, radius: b.radius }))
				: [];

			let glowX: number | null = null;
			if (playing) {
				// Project each resting ball onto the code input it owns. Done live, so a
				// ball that re-settles in a new slot — from a resize bump, or after a
				// removal wakes the pile — updates its own input without changing which
				// input it owns. `game.dropped` is the slot the *next* ball will fill (a
				// freed one if you've removed a ball), or CODE_LENGTH when full.
				const entered = projectEntered(CODE_LENGTH, slotLetterAt);
				for (let i = 0; i < CODE_LENGTH; i++) {
					if (game.entered[i] !== entered[i]) game.entered[i] = entered[i];
				}
				const next = nextSlot(CODE_LENGTH) ?? CODE_LENGTH;
				if (game.dropped !== next) game.dropped = next;

				// hard mode: a single ball settled in the wrong slot ends the round now
				checkInstantFail();

				// Predicted landing for the current aim (lone ball, empty board). When
				// it matches the next required letter, the preview goes green and the
				// target slot glows — turning aiming into a deterministic skill. Skipped
				// entirely when the on-target highlight is switched off.
				if (settings.onTargetGlow && game.dropped < CODE_LENGTH) {
					const m = muzzle(apparatus.x, world.cupWidth, apparatus.angle);
					const vel = launchVelocity(apparatus.angle);
					const idx = predictLanding(simWorld, m.x, m.y, vel.x, vel.y, blockers);
					if (idx !== null && world.cups[idx].letter === game.target[game.dropped]) {
						glowX = world.cups[idx].centerX;
					}
				}
			}

			// sub-frame interpolation alpha: how far we are through the current physics step
			const alpha = acc / FIXED_DT;

			ctx.clearRect(0, 0, world.width, world.height);
			if (glowX !== null) drawSlotGlow(ctx, world, glowX, time);
			// the win/lose screen clears the playfield — only the cannon's aim
			// guideline (and the stage frame) stay alongside the result message
			if (playing) {
				drawDomes(ctx, world);
				if (settings.pegs && settings.railHandles) drawPegLine(ctx, world);
				if (settings.pegs) drawPegs(ctx, world);
			} else if (inSandbox) {
				drawWedges(ctx, world);
			}
			if (settings.guideline) drawTrajectory(ctx, world, time, glowX !== null, simWorld, blockers);
			if (playing) drawLetters(ctx, world, glowX);
			// balls render during play and in the win-screen sandbox (hidden on a loss)
			if (game.status !== "failure") for (const ball of balls) drawBall(ctx, ball, alpha);
			drawEdges(ctx, world);

			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);

		// fire a ball from the muzzle along the current aim
		const fire = (): void => {
			if (game.status !== "playing") return; // win/lose: no manual release
			launchBall(world.cupWidth, CODE_LENGTH); // no-op when full
		};

		// Pan + aim: while idle the cannon pans to follow the pointer (angle 0). On
		// press it locks its position and the drag aims toward the pointer
		// (±MAX_AIM); release fires. pointerdown is on the canvas so the DOM
		// cannon/handles/buttons above it keep their own gestures; move/up are on
		// the window so a drag continues off the canvas.
		let aiming = false;
		let panningCanvas = false; // touch-only: dragging the win/lose canvas steers the cannon
		const stageX2 = (clientX: number): number => clientX - stageX; // window → stage coords

		// move the cannon's pivot to a window x, clamped to keep the base on-stage
		const panTo = (clientX: number): void => {
			const margin = world.cupWidth * CANNON_BASE_RATIO;
			apparatus.x = Math.min(Math.max(stageX2(clientX), margin), world.width - margin);
		};

		// topmost resting ball under a stage-space point (later balls draw on top).
		// `slop` pads the hit radius — a fingertip needs a far bigger target than a
		// mouse cursor, so touch presses get a generous one (see onPointerDown).
		const restingBallAt = (sx: number, sy: number, slop = 2): Ball | null => {
			for (let k = balls.length - 1; k >= 0; k--) {
				const b = balls[k];
				if (b.resting && Math.hypot(b.pos.x - sx, b.pos.y - sy) <= b.radius + slop) return b;
			}
			return null;
		};

		const onPointerDown = (e: PointerEvent): void => {
			if (apparatus.panning) return; // the top-panel grab handle owns the cannon
			// win/lose: no aiming — on touch a press-drag steers the cannon left/right (no
			// angle change). Desktop is untouched: the mouse already pans on hover, so a
			// mouse press here stays a no-op, exactly as before.
			if (game.status !== "playing") {
				if (e.pointerType !== "mouse") {
					panningCanvas = true;
					panTo(e.clientX);
				}
				return;
			}
			// During play: click a resting ball to remove it, else aim.
			// fingertips are imprecise, so touch gets a much larger tap target than a mouse
			// fingertips are imprecise, so touch gets a much larger tap target than a mouse
			const slop = e.pointerType === "touch" ? 16 : 2;
			const hit = restingBallAt(stageX2(e.clientX), e.clientY, slop);
			if (hit) {
				removeBall(hit);
				hover.slot = -1;
				return;
			}
			aiming = true;
			hover.slot = -1;
			apparatus.angle = aimAngle(stageX2(e.clientX), e.clientY, apparatus.x);
		};
		const onPointerMove = (e: PointerEvent): void => {
			if (panningCanvas) {
				panTo(e.clientX); // win/lose: steer the cannon, no angle change
				return;
			}
			if (aiming) {
				apparatus.angle = aimAngle(stageX2(e.clientX), e.clientY, apparatus.x);
				return;
			}
			// the top-panel owns the cannon while it's being grabbed — don't hover-pan over it
			if (pegs.dragging || apparatus.panning) return;
			// hover-pan + hover-highlight are mouse-only: on touch there's no hover, so a
			// stray move during a tap must not yank the cannon (it's moved via the handle)
			if (e.pointerType !== "mouse") return;
			const sx = stageX2(e.clientX);
			if (game.status === "playing") {
				// hover a resting ball → highlight the input it owns
				const hit = restingBallAt(sx, e.clientY);
				hover.slot = hit ? (slotFor(hit) ?? -1) : -1;
				canvas.style.cursor = hit ? "pointer" : "";
			}
			// pan the cannon to follow the pointer
			const margin = world.cupWidth * CANNON_BASE_RATIO;
			apparatus.x = Math.min(Math.max(sx, margin), world.width - margin);
			apparatus.angle = 0;
		};
		const onPointerUp = (e: PointerEvent): void => {
			if (panningCanvas) {
				panningCanvas = false;
				return;
			}
			if (!aiming) return;
			aiming = false;
			// Touch decouples aim from fire and keeps the aim from the last drag move:
			// reading the release point here would let the finger's lift-off wobble nudge
			// the angle (the precision-killer on mobile), so leave it untouched — the arc
			// preview stays put and the Fire button launches it. Desktop fires on release.
			if (touch.coarse) return;
			apparatus.angle = aimAngle(stageX2(e.clientX), e.clientY, apparatus.x);
			fire();
			apparatus.angle = 0; // back to straight-down while panning resumes
		};
		// a gesture the browser/OS takes over (second finger, system swipe) cancels
		// the aim without firing — just drop back to idle so the cannon isn't stuck
		const onPointerCancel = (): void => {
			panningCanvas = false;
			if (!aiming) return;
			aiming = false;
			apparatus.angle = 0;
		};

		window.addEventListener("resize", resize);
		canvas.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", onPointerUp);
		window.addEventListener("pointercancel", onPointerCancel);

		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("resize", resize);
			canvas.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
			window.removeEventListener("pointercancel", onPointerCancel);
		};
	});
</script>

<!-- the canvas IS the play area: width-capped and centered (left/size set in resize).
	 touch-none stops the browser from claiming a press-drag as a scroll/zoom gesture
	 (which would fire pointercancel and kill the aim drag on touch devices) -->
<canvas 
	bind:this={canvas} 
	class="fixed top-0 left-0 touch-none transition-opacity duration-300"
	class:opacity-0={game.status === 'failure'}
></canvas>
