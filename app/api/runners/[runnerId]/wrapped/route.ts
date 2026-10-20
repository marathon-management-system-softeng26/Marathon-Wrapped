import { getRunnerChipInput } from "@/controllers/runnerController";

export async function GET(request: Request, { params }: {params: Promise<{ runnerId: string }>} ) {
    const { runnerId } = await params;

    try {
        const input = await getRunnerChipInput(runnerId);

        if (!input) {
            return new Response(JSON.stringify({ error: "Runner not found" }), { status: 404 });
        }

        return new Response(JSON.stringify(input), { status: 200 });

    } catch (error) {
     console.error("Failed to fetch runner chip input:", error);
     return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });   
    }


}