require('dotenv').config();
const fetch = require('node-fetch');
const AWS = require('aws-sdk');
const psl = require('psl');

const registryPassword = "asdf";
const registryURL = "336117440908.dkr.ecr.us-east-1.amazonaws.com";

async function init() {
	checkENVVariables();

	while (true) {
		const error = await startWorker();

		if (error) await new Promise(res => setTimeout(res, 2 * 60 * 1000));
		else await new Promise(res => setTimeout(res, 6 * 60 * 60 * 1000));
	}
}

async function startWorker() {
	try {
		log("Starting worker");

		const { registryURL, registryPassword } = await awsProcess();
	
		await rancherProcess(registryURL, registryPassword);

	} catch (error) {
		log(error);
		log("Worker will rerun in 2 minutes");
		return true;
	}
}

function checkENVVariables() {
	if (!process.env.AWS_REGION) { log("AWS_REGION env variable not present"); process.exit(1); }
	if (!process.env.AWS_ACCESS_KEY_ID) { log("AWS_ACCESS_KEY_ID env variable not present"); process.exit(1); }
	if (!process.env.AWS_SECRET_ACCESS_KEY) { log("AWS_SECRET_ACCESS_KEY env variable not present"); process.exit(1); }
	if (!process.env.RANCHER_ACCESS_KEY) { log("RANCHER_ACCESS_KEY env variable not present"); process.exit(1); }
	if (!process.env.RANCHER_SECRET_KEY) { log("RANCHER_SECRET_KEY env variable not present"); process.exit(1); }
	if (!process.env.RANCHER_URL) { log("RANCHER_URL env variable not present"); process.exit(1); }
}

async function awsProcess() {
	const ECR = new AWS.ECR();

	return new Promise((resolve, reject) => {
		ECR.getAuthorizationToken({}, function(err, data) {
			if (err) return reject(err);
			
			let registryURL = data.authorizationData[0].proxyEndpoint;
			const registryPassword = Buffer.from(data.authorizationData[0].authorizationToken, "base64").toString().split(":")[1];

			if (registryURL.indexOf("//") > -1) {
				registryURL = registryURL.split('//')[1];
			}

			resolve({registryURL, registryPassword});
		})
	});
}

async function rancherProcess(awsRegistryURL, registryPassword) {
	const project = await getRancherProject();
	const registry_data = await getRancherECRRegistry(project, awsRegistryURL);

	if (registry_data) await updateRancherECRRegistry(registry_data, awsRegistryURL, registryPassword);
	else await createRancherECRRegistry(project, awsRegistryURL, registryPassword);
}

async function getRancherProject() {
	const response = await fetch(`${process.env.RANCHER_URL}/projects`, { headers: getRancherAuthHeader() });

	if (response.status !== 200) { throw new Error("Unable to fetch projects from rancher"); }

	const response_body = await response.json();
	
	const project_name = process.env.RANCHER_PROJECT || "Default";
	const project = response_body.data.find(elem => elem.name === project_name);

	if (!project) { throw new Error("Project not found"); }

	return project;
}

async function getRancherECRRegistry(project, registryURL) {
	const response = await fetch(project.links.dockerCredentials, { headers: getRancherAuthHeader() });

	if (response.status !== 200) { throw new Error("Unable to fetch docker credientials from rancher"); }

	const response_body = await response.json();

	for (const record of response_body.data) {
		if (record.registries[registryURL])
			return { update_url: record.links.update, data_obj: record.registries };
	}

	return null;
}

async function createRancherECRRegistry(project, registryURL, registryPassword) {
	const reg_obj = {
		name: "ecr-registry",
		type: "dockerCredential",
		namespaceId: "__TEMP__",
		registries: {
			[registryURL]: {
				username: "AWS",
				password: registryPassword
			}
		}
	};

	const response = await fetch(project.links.dockerCredentials, {
		headers: getRancherAuthHeader(),
		method: "POST",
		body: JSON.stringify(reg_obj)
	});

	if (response.status !== 201) { throw new Error("Unable to create registry on Rancher"); }

	log("Registry created with new password");
}

async function updateRancherECRRegistry(registry_data, awsRegistryURL, registryPassword) {
	const reg_obj = {
		registries: registry_data.data_obj
	};
	reg_obj.registries[awsRegistryURL].password = registryPassword;

	const response = await fetch(registry_data.update_url, {
		headers: getRancherAuthHeader(),
		method: "PUT",
		body: JSON.stringify(reg_obj)
	});

	if (response.status !== 200) { throw new Error("Unable to create registry on Rancher"); }

	log("Registry password updated");
}

function getRancherAuthHeader() {
	return {
		Authorization: 'Basic ' + Buffer.from(process.env.RANCHER_ACCESS_KEY + ":" + process.env.RANCHER_SECRET_KEY).toString('base64')
	};
}

function log(text) {
	console.log(`[${Date()}] ${text}`);
}

init();