import unittest

from server.state_machine import JobStateMachine, stage_status


class JobStateMachineTest(unittest.TestCase):
    def test_moves_job_to_processing_and_completed(self):
        machine = JobStateMachine()

        state = machine.apply("claimed")
        self.assertEqual(state.status, "processing")
        self.assertEqual(state.current_stage, "claimed")

        state = machine.apply("ffmpeg_preprocess")
        self.assertEqual(state.status, "processing")
        self.assertEqual(state.current_stage, "ffmpeg_preprocess")

        state = machine.apply("ai_postprocessing")
        self.assertEqual(state.status, "processing")
        self.assertEqual(state.current_stage, "ai_postprocessing")

        state = machine.apply("completed")
        self.assertEqual(state.status, "completed")
        self.assertEqual(state.current_stage, "completed")

    def test_rejects_unknown_stage(self):
        machine = JobStateMachine()
        with self.assertRaisesRegex(ValueError, "Unknown stage"):
            machine.apply("not_a_stage")

    def test_stage_status_mapping(self):
        self.assertEqual(stage_status("claimed"), "processing")
        self.assertEqual(stage_status("completed"), "completed")
        self.assertEqual(stage_status("failed"), "failed")
        self.assertIsNone(stage_status("ffmpeg_preprocess"))


if __name__ == "__main__":
    unittest.main()
