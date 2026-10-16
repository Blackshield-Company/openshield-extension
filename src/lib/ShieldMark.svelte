<script lang="ts">
  // Master OpenShield mark (docs/brand/shield.svg): steel rim, plain Greek cross.
  let { size = 20 }: { size?: number } = $props();
</script>

<svg class="shield-mark" width={size} height={(size * 110) / 92} viewBox="4 0 92 110" aria-hidden="true">
  <path d="M50 4C62 9 74 11 90 12 89 50 78 80 50 104 22 80 11 50 10 12 26 11 38 9 50 4Z" fill="#17171D" stroke="#9AA0A8" stroke-width="5" stroke-linejoin="round" />
  <path d="M44 30H56V46H72V58H56V74H44V58H28V46H44Z" fill="#C1121F" />
</svg>
