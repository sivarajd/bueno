/**
 * Build Command
 *
 * Build the application for production
 */

import { defineCommand } from './index';
import { getOption, hasFlag, type ParsedArgs } from '../core/args';
import { cliConsole, colors, formatSize, formatDuration } from '../core/console';
import { spinner } from '../core/spinner';
import {
	fileExists,
	getProjectRoot,
	isBuenoProject,
	joinPaths,
	readFile,
	deleteDirectory,
	listFiles,
} from '../utils/fs';
import { CLIError, CLIErrorType } from '../index';

/**
 * Build targets
 */
type BuildTarget = 'bun' | 'node' | 'standalone';

/**
 * Find the entry point for the application
 */
async function findEntryPoint(projectRoot: string): Promise<string | null> {
	const possibleEntries = [
		'server/main.ts',
		'src/main.ts',
		'src/index.ts',
		'main.ts',
		'index.ts',
		'server.ts',
		'app.ts',
	];

	for (const entry of possibleEntries) {
		const entryPath = joinPaths(projectRoot, entry);
		if (await fileExists(entryPath)) {
			return entry;
		}
	}

	return null;
}

/**
 * Handle build command
 */
async function handleBuild(args: ParsedArgs): Promise<void> {
	// Get options
	const target = getOption(args, 'target', {
		name: 'target',
		alias: 't',
		type: 'string',
		default: 'bun',
		description: '',
	}) as BuildTarget;

	const outDir = getOption<string>(args, 'outdir', {
		name: 'outdir',
		alias: 'o',
		type: 'string',
		default: './dist',
		description: '',
	});

	const minify = !hasFlag(args, 'no-minify');
	const sourcemap = hasFlag(args, 'sourcemap');
	const analyze = hasFlag(args, 'analyze');
	const configPath = getOption(args, 'config', {
		name: 'config',
		alias: 'c',
		type: 'string',
		description: '',
	});

	// Validate target
	const validTargets: BuildTarget[] = ['bun', 'node', 'standalone'];
	if (!validTargets.includes(target)) {
		throw new CLIError(
			`Invalid target: ${target}. Valid targets: ${validTargets.join(', ')}`,
			CLIErrorType.INVALID_ARGS,
		);
	}

	// Check if in a Bueno project
	const projectRoot = await getProjectRoot();
	if (!projectRoot) {
		throw new CLIError(
			'Not in a project directory. Run this command from a Bueno project.',
			CLIErrorType.NOT_FOUND,
		);
	}

	if (!(await isBuenoProject())) {
		throw new CLIError(
			'Not a Bueno project. Make sure you have a bueno.config.ts or bueno in your dependencies.',
			CLIErrorType.NOT_FOUND,
		);
	}

	// Find entry point
	const entryPoint = await findEntryPoint(projectRoot);
	if (!entryPoint) {
		throw new CLIError(
			'Could not find entry point. Make sure you have a main.ts or index.ts file.',
			CLIErrorType.FILE_NOT_FOUND,
		);
	}

	// Display build info
	cliConsole.header('Building for Production');
	cliConsole.log(`${colors.bold('Entry:')} ${entryPoint}`);
	cliConsole.log(`${colors.bold('Target:')} ${target}`);
	cliConsole.log(`${colors.bold('Output:')} ${outDir}`);
	cliConsole.log(`${colors.bold('Minify:')} ${minify ? colors.green('enabled') : colors.red('disabled')}`);
	cliConsole.log(`${colors.bold('Sourcemap:')} ${sourcemap ? colors.green('enabled') : colors.red('disabled')}`);
	cliConsole.log('');

	const startTime = Date.now();
	const s = spinner('Building...');

	try {
		// Clean output directory
		const fullOutDir = joinPaths(projectRoot, outDir);
		if (await fileExists(fullOutDir)) {
			await deleteDirectory(fullOutDir);
		}

		// Build using Bun
		const buildResult = await Bun.build({
			entrypoints: [joinPaths(projectRoot, entryPoint)],
			outdir: fullOutDir,
			target: target === 'node' ? 'node' : 'bun',
			minify,
			sourcemap: sourcemap ? 'external' : undefined,
			splitting: true,
			format: 'esm',
			external: target === 'standalone' ? [] : ['bun:*'],
			define: {
				'process.env.NODE_ENV': '"production"',
			},
		});

		if (!buildResult.success) {
			s.error();
			for (const error of buildResult.logs) {
				cliConsole.error(error.message);
			}
			throw new CLIError(
				'Build failed',
				CLIErrorType.TEMPLATE_ERROR,
			);
		}

		const elapsed = Date.now() - startTime;

		// Get output files info
		const outputFiles = await listFiles(fullOutDir, { recursive: true });
		const totalSize = outputFiles.reduce((acc, file) => {
			const stat = require('fs').statSync(file);
			return acc + stat.size;
		}, 0);

		s.success(`Build completed in ${formatDuration(elapsed)}`);

		// Show output info
		cliConsole.log('');
		cliConsole.log(`${colors.bold('Output Files:')}`);
		for (const file of outputFiles.slice(0, 10)) {
			const stat = require('fs').statSync(file);
			const relativePath = file.replace(projectRoot, '.');
			cliConsole.log(`  ${colors.dim(relativePath)} ${colors.dim(`(${formatSize(stat.size)})`)}`);
		}
		if (outputFiles.length > 10) {
			cliConsole.log(`  ${colors.dim(`... and ${outputFiles.length - 10} more files`)}`);
		}
		cliConsole.log('');
		cliConsole.log(`${colors.bold('Total Size:')} ${formatSize(totalSize)}`);

		// Analyze if requested
		if (analyze) {
			cliConsole.log('');
			cliConsole.header('Bundle Analysis');
			cliConsole.log('Entry points:');
			for (const entry of buildResult.outputs) {
				cliConsole.log(`  ${entry.path} (${formatSize(entry.size)})`);
			}
		}

		// Show standalone build info
		if (target === 'standalone') {
			cliConsole.log('');
			cliConsole.info('Standalone executable created. You can run it directly:');
			cliConsole.log(colors.cyan(`  .${outDir}/${entryPoint.replace('.ts', '')}`));
		}

	} catch (error) {
		s.error();
		throw error;
	}
}

// Register the command
defineCommand(
	{
		name: 'build',
		description: 'Build the application for production',
		options: [
			{
				name: 'target',
				alias: 't',
				type: 'string',
				default: 'bun',
				description: 'Build target (bun, node, standalone)',
			},
			{
				name: 'outdir',
				alias: 'o',
				type: 'string',
				default: './dist',
				description: 'Output directory',
			},
			{
				name: 'no-minify',
				type: 'boolean',
				default: false,
				description: 'Disable minification',
			},
			{
				name: 'sourcemap',
				type: 'boolean',
				default: false,
				description: 'Generate source maps',
			},
			{
				name: 'analyze',
				type: 'boolean',
				default: false,
				description: 'Analyze bundle size',
			},
			{
				name: 'config',
				alias: 'c',
				type: 'string',
				description: 'Path to config file',
			},
		],
		examples: [
			'bueno build',
			'bueno build --target node',
			'bueno build --target standalone',
			'bueno build --sourcemap',
			'bueno build --analyze',
		],
	},
	handleBuild,
);