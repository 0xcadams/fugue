export const demoUserID = "demo-user";
export const demoBoardID = "board-demo";

export type Lane = "todo" | "doing" | "done";

export const laneOrder = ["todo", "doing", "done"] as const;

export const laneTitles: { [Key in Lane]: string } = {
  todo: "Todo",
  doing: "Doing",
  done: "Done",
};
