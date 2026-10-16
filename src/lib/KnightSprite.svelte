<script lang="ts">
  // Animated OpenShield knight. Each state is an SVG with CSS step keyframes;
  // under prefers-reduced-motion a still PNG of the first frame is used instead.
  type KnightState = "idle" | "thinking" | "working" | "success" | "error";
  let { state = "idle", size = 32, label = "" }: { state?: KnightState; size?: number; label?: string } = $props();
</script>

<picture class="knight" style:width="{size}px" style:height="{(size * 28) / 32}px">
  <source srcset="/knight/knight-{state}-still.png" media="(prefers-reduced-motion: reduce)" />
  <img src="/knight/knight-{state}.svg" width={size} height={(size * 28) / 32} alt={label} aria-hidden={label ? undefined : "true"} />
</picture>

<style>
  .knight { display: inline-block; flex: none; line-height: 0; }
  img { image-rendering: pixelated; width: 100%; height: 100%; }
</style>
