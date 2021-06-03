enum ContentStatus {
	BH_CONTENT_INVALID_TYPE,
	BH_CONTENT_INVALID_BODY
}

export enum DataFieldType {
	STRING,
	NUMBER,
	BOOLEAN
}

export interface IContentDataField {
	name: string,
	type: DataFieldType,
	maxLength?: number,
	minLength?: number
}

export interface IContentType {
	name: string,

	// Fields in content data
	fields?: Array<IContentDataField>,

	// Editable fields
	editable?: Array<string>,

	// Size of the resource file(s) in bytes
	resourceFileSize?: number

	// Blacklists content types that can be attached eg.
	// comment can be added but not the vote
	attachBlacklist?: Array<string>
}

interface IContentTypes {
	types: Array<IContentType>,
	getTypeByName: (name: string) => IContentType | null
}

export function MiBtoBytes(mib: number) {
	return mib * 1048576;
}

export const ContentTypes: IContentTypes = {
	types: [
		{
			name: "bh.content.type.video",
			fields: [
				{
					name: "title",
					type: DataFieldType.STRING,
					maxLength: 70,
					minLength: 1
				},
				{
					name: "description",
					type: DataFieldType.STRING,
					maxLength: 2000,
					minLength: 0
				},
				{
					name: "video",
					type: DataFieldType.STRING,
				},
				{
					name: "thumbnail",
					type: DataFieldType.STRING
				}
			],
			editable: [ "title", "description" ],
			resourceFileSize: MiBtoBytes(512)
		},
	],

	getTypeByName(name: string): IContentType | null {
		let type = null;
		this.types.forEach((_type: IContentType) => {
			if(_type.name == name) {
				type = _type;
			}
		});

		return type;
	}
};