<template>
	<section class="h-full">
		<!-- Layout container switches between column (horizontal nav top) and row (vertical nav left) -->
		<div
			:class="
				orientation === 'vertical' ? 'flex h-full' : 'flex h-screen flex-col'
			"
		>
			<!-- Navigation area-->
			<div
				:class="[
					'border-gray-200',
					orientation === 'vertical'
						? 'min-w-[256px] border-r'
						: 'border-b px-4 py-2',
				]"
			>
				<!-- Custom navigation wired via composable router -->
				<nav
					:class="
						orientation === 'vertical'
							? 'flex flex-col gap-1'
							: 'flex items-center gap-4'
					"
				>
					<template v-for="(group, gi) in items" :key="gi">
						<div
							:class="
								orientation === 'vertical'
									? 'flex flex-col gap-1 px-2 py-2'
									: 'flex flex-1 items-center gap-2'
							"
						>
							<button
								v-for="(it, ii) in group"
								:key="ii"
								type="button"
								:class="[
									'cursor-pointer rounded-md hover:bg-gray-100',
									orientation === 'vertical'
										? 'px-2 py-1 text-left'
										: 'px-1 py-1',
									isActive(it) ? 'text-primary-600' : 'hover:text-gray-900',
								]"
								@click="onItemClick(it)"
							>
								<span class="inline-flex items-center gap-2">
									<UIcon v-if="it.icon" :name="it.icon" />
									<span>{{ it.label }}</span>
								</span>
							</button>
						</div>
					</template>
				</nav>
			</div>

			<!-- Main Content -->
			<div
				:class="orientation === 'vertical' ? 'flex-1 min-h-0 overflow-hidden' : 'flex-1 min-h-0 overflow-hidden'"
			>
				<slot />
			</div>
		</div>
	</section>
</template>
<script setup lang="ts">
	import { useComponentRouter } from '#imports';
	import type { NavigationMenuItem } from '@nuxt/ui';

	const props = withDefaults(
		defineProps<{
			orientation?: 'horizontal' | 'vertical';
			items?: (NavigationMenuItem & { path?: string })[][];
			activeMatch?: 'exact' | 'prefix';
		}>(),
		{
			orientation: 'horizontal',
			activeMatch: 'prefix',
		}
	);

	const router = useComponentRouter();

	function onItemClick(it: NavigationMenuItem & { path?: string }) {
		if (it.path) {
			router.push(it.path);
		}
	}

	function isActive(it: NavigationMenuItem & { path?: string }) {
		if (!it.path) return false;
		const current = router.route?.value?.path || '';
		if (props.activeMatch === 'prefix') return isPrefixActive(current, it.path);
		return current === it.path;
	}

	function isPrefixActive(current: string, base: string) {
		// Root should not match everything
		if (base === '/') return current === '/';
		if (current === base) return true;
		// Ensure boundary match: '/packages' matches '/packages/...' but not '/packagesX'
		return current.startsWith(base.endsWith('/') ? base : base + '/');
	}
</script>
