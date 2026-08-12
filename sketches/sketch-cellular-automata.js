// ============================================================
// AUDIO-REACTIVE CELLULAR AUTOMATA — instance-mode tile sketch
// ============================================================
// B3/S23 automaton. Live cells are injected on detected onsets
// (shared spectral-flux transient detector) rather than a raw
// bass-level threshold, so it responds to attacks/hits instead of
// sustained loudness. Hue follows spectral centroid (timbral
// brightness) instead of raw treble energy, mid steers saturation,
// volume controls step speed.
function createCellularAutomataSketch(container) {
  return new p5((p) => {
    let cols, rows, grid, ages;
    const cellSize = 8;
    let caFrameCounter = 0;
    const bloomHueBase = 200;

    p.setup = () => {
      const cnv = p.createCanvas(640, 480);
      cnv.parent(container);
      p.colorMode(p.HSB, 360, 100, 100, 100);
      p.background(14, 10, 8);
      p.frameRate(30);
      initGrid();

      AudioShared.onOnset((strength) => {
        const injections = Math.floor(4 + strength * 22);
        for (let k = 0; k < injections; k++) {
          const x = Math.floor(p.random(cols));
          const y = Math.floor(p.random(rows));
          grid[x][y] = 1;
          ages[x][y] = 0;
        }
      });
    };

    function initGrid() {
      cols = Math.floor(p.width / cellSize);
      rows = Math.floor(p.height / cellSize);
      grid = []; ages = [];
      for (let i = 0; i < cols; i++) {
        grid.push(new Array(rows).fill(0));
        ages.push(new Array(rows).fill(0));
      }
      for (let i = 0; i < 40; i++) {
        const x = Math.floor(p.random(cols));
        const y = Math.floor(p.random(rows));
        grid[x][y] = 1;
      }
    }

    p.draw = () => {
      if (!AudioShared.ready) return;

      AudioShared.fft.analyze();
      const mid = AudioShared.fft.getEnergy('mid') / 255;

      p.background(14, 10, 8, 25);

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          if (grid[i][j] === 1) {
            const hue = (bloomHueBase + AudioShared.centroid * 260 + ages[i][j] * 2) % 360;
            p.fill(hue, 60 + mid * 30, 90);
            p.noStroke();
            p.rect(i * cellSize, j * cellSize, cellSize - 1, cellSize - 1);
          }
        }
      }

      caFrameCounter++;
      const volume = AudioShared.amp.getLevel();
      const stepEvery = Math.max(1, Math.floor(6 - volume * 20));
      if (caFrameCounter % stepEvery === 0) stepCA();
    };

    function stepCA() {
      const next = [], nextAges = [];
      for (let i = 0; i < cols; i++) {
        next.push(new Array(rows).fill(0));
        nextAges.push(new Array(rows).fill(0));
      }
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const n = countNeighbors(i, j);
          const alive = grid[i][j] === 1;
          if (alive && (n === 2 || n === 3)) {
            next[i][j] = 1; nextAges[i][j] = ages[i][j] + 1;
          } else if (!alive && n === 3) {
            next[i][j] = 1; nextAges[i][j] = 0;
          }
        }
      }
      grid = next; ages = nextAges;
    }

    function countNeighbors(x, y) {
      let sum = 0;
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          if (i === 0 && j === 0) continue;
          const col = (x + i + cols) % cols;
          const row = (y + j + rows) % rows;
          sum += grid[col][row];
        }
      }
      return sum;
    }
  });
}
