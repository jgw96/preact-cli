import path from 'path';
import fs from 'fs.promised';
import ip from 'ip';
import webpack from 'webpack';
import WebpackDevServer from 'webpack-dev-server';
import chalk from 'chalk';
import clientConfig from './webpack-client-config';
import serverConfig from './webpack-server-config';
import transformConfig from './transform-config';

export default async (watch=false, env, onprogress) => {
	if (watch) {
		return await devBuild(env, onprogress);
	}

	return await prodBuild(env);
};

const devBuild = async (env, onprogress) => {
	let config = clientConfig(env);
	await transformConfig(env, config);

	let compiler = webpack(config);
	return await new Promise((resolve, reject) => {
		let first = true;
		compiler.plugin('done', stats => {
			if (first) {
				first = false;
				let devServer = config.devServer;

				let protocol = devServer.https ? 'https' : 'http';
				let host = process.env.HOST || devServer.host || 'localhost';
				let port = process.env.PORT || devServer.port || 8080;

				let serverAddr = `${protocol}://${host}:${port}`;
				let localIpAddr = `${protocol}://${ip.address()}:${port}`;

				process.stdout.write(chalk.green('Compiled successfully!!\n\n'));
				process.stdout.write('You can view the application in the browser.\n\n');
				process.stdout.write(`${chalk.bold('Local:')}            ${serverAddr}\n`);
				process.stdout.write(`${chalk.bold('On Your Network:')}  ${localIpAddr}\n`);
			}
			if (onprogress) onprogress(stats);
		});
		compiler.plugin('failed', reject);

		let server = new WebpackDevServer(compiler, config.devServer);
		server.listen(config.devServer.port);
	});
};

const prodBuild = async (env) => {
	let compiler, client = clientConfig(env);

	await transformConfig(env, client);

	if (env.prerender) {
		let ssrConfig = serverConfig(env);
		await transformConfig(env, ssrConfig, true);
		compiler = webpack([client, ssrConfig]);
	} else {
		compiler = webpack(client);
	}

	return await new Promise((resolve, reject) => {
		compiler.run((err, stats) => {
			if (err || stats.hasErrors()) {
				reject(err || stats.toJson().errors.join('\n'));
			}
			else {
				// Timeout for plugins that work on `after-emit` event of webpack
				setTimeout(()=>	resolve(stats), 20);
			}
		});
	});
};

export function showStats(stats) {
	let info = stats.toJson();

	if (stats.hasErrors()) {
		info.errors.forEach( message => {
			process.stderr.write(message+'\n');
		});
	}

	if (stats.hasWarnings()) {
		info.warnings.forEach( message => {
			process.stderr.write(chalk.yellow(message)+'\n');
		});
	}

	return stats;
}

export function writeJsonStats(stats) {
	let outputPath = path.resolve(process.cwd(), 'stats.json');
	let jsonStats = stats.toJson({
		json: true,
		chunkModules: true,
		source: false,
	});

	jsonStats = (jsonStats.children && jsonStats.children[0]) || jsonStats;

	jsonStats.modules.forEach(normalizeModule);
	jsonStats.chunks.forEach(c => c.modules.forEach(normalizeModule));

	return fs.writeFile(outputPath, JSON.stringify(jsonStats))
		.then(() => {
			process.stdout.write('\nWebpack output stats generated.\n\n');
			process.stdout.write('You can upload your stats.json to:\n');
			process.stdout.write('- https://chrisbateman.github.io/webpack-visualizer/\n');
			process.stdout.write('- https://webpack.github.io/analyse/\n');
		});
}

const normalizeModule = m => {
	const keysToNormalize = ['identifier', 'name', 'module', 'moduleName', 'moduleIdentifier'];

	keysToNormalize.forEach(key => {
		if (key in m) {
			m[key] = normalizeName(m[key]);
		}
	});

	if (m.reasons) {
		m.reasons.forEach(normalizeModule);
	}

	return m;
};

const normalizeName = p => p.substr(p.lastIndexOf('!') + 1);
