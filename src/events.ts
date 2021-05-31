let listeners = new Map();

export enum Events {
	USER_REMOVE_ACCOUNT = "user.remove_account"
}

export function sendEvent(name: string, data: any) {
	if (listeners.has(name)) {
		listeners.get(name).forEach((callback: (data: any) => void) => {
			callback(data);
		});
	}
}

export function listenEvent(name: string, callback: (data: any) => void) {
	if (listeners.has(name)) {
		listeners.get(name).push(callback);
	} else {
		listeners.set(name, [callback]);
	}
}