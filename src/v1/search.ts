import config from "../../config/default";
import { genBasicResponses, Status, generateIdForModel } from "./common";
import { FastifyInstance, FastifySchema } from "fastify";
import { searchBetweenContent } from "./content";

interface ISearchQueryPageParam {
	query: string,
	page: number
}

export default function (app: FastifyInstance, _opts: any, done: any) {
	app.get<{
		Params: ISearchQueryPageParam
	}>("/:query/:page", {
		schema: {
			tags: ["Search"],
			params: {
				type: 'object',
				properties: {
					query: { type: 'string' },
					page: { type: 'number' }
				}
			},
			response: genBasicResponses({
				page: { type: 'object', additionalProperties: {} }
			})
		} as FastifySchema,
		preHandler: app.rateLimit({
			max: 30,
			timeWindow: '1 minute'
		})
	}, async (req, res) => {
		res.send({
			status: Status.BH_SUCCESS,
			content: {
				page: await searchBetweenContent(req.params.page, `%${req.params.query}%`)
			}
		});
	});

	done();
}